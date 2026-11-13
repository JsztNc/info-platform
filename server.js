#!/usr/bin/env node
/**
 * 信息平台 — 江苏中天自研程序的云端授权 + 消息反馈后台
 *
 * 功能：
 *   1) 权限查询接口  GET  /api/check?app=程序名&code=授权码
 *      -> {"ok":true,"app":"日报工具","owner":"张三","expires":"2026-12-31","msg":"授权有效"}
 *      设备模式（V1.15）：GET /api/check?app=程序名&device=设备唯一ID&name=计算机名&user=&os=&ver=
 *      -> 首次上报自动登记并授权；管理员在后台停用后同设备返回 ok:false
 *   2) 消息反馈接口  POST /api/feedback  {app, code, device, user, content}
 *      -> {"ok":true}   管理端后台可查看、标记已读、删除
 *   3) 管理端       /      密码登录后管理授权记录、设备与反馈
 *
 * 数据：data.json（同目录），每次改动原子落盘。
 * 端口：process.env.PORT || 3000
 * 依赖：无（纯 Node 内置模块）
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ============ 配置（密码放 config.local.json，不进仓库） ============
// 同目录 config.local.json 格式：{ "ADMIN_PASS": "你的密码" }
// 该文件已 gitignore，仓库里只有占位说明；没配则用占位密码，登录会失败提示去配置。
let ADMIN_PASS = 'changeme';
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.local.json'), 'utf8'));
  if (cfg && cfg.ADMIN_PASS) ADMIN_PASS = String(cfg.ADMIN_PASS);
} catch (e) { /* 无配置文件，用占位密码 */ }
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

// ============ 数据存取 ============
let data = { records: [], feedback: [], devices: [], seq: 1 };

function load() {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(data.records)) data.records = [];
    if (!Array.isArray(data.feedback)) data.feedback = [];
    if (!Array.isArray(data.devices)) data.devices = [];
    if (!data.seq) data.seq = 1;
  } catch (e) {
    // 首次运行或文件损坏：用默认空数据，不覆盖已有文件内容为空时才初始化
    data = { records: [], feedback: [], devices: [], seq: 1 };
  }
}

function save() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

load();

function nextId() { return data.seq++; }

// ============ 工具 ============
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { resolve(JSON.parse(raw || '{}')); } catch (e) { resolve({}); }
    });
  });
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isExpired(expires) {
  if (!expires) return false;               // 留空 = 永久
  return new Date(expires + 'T23:59:59').getTime() < Date.now();
}

// 客户端 IP（云端有反向代理，优先 X-Forwarded-For）
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = xf || (req.socket && req.socket.remoteAddress) || '';
  return ip.replace(/^::ffff:/, '');
}

// ============ 路由 ============
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;

  // ---------- 静态文件 ----------
  if (p === '/' || !p.startsWith('/api/')) {
    let file = p === '/' ? '/index.html' : p;
    const full = path.join(PUBLIC_DIR, path.normalize(file).replace(/^([.][.][\\/])+/, ''));
    if (!full.startsWith(PUBLIC_DIR)) return json(res, 403, { ok: false, msg: 'forbidden' });
    fs.readFile(full, (err, buf) => {
      if (err) return json(res, 404, { ok: false, msg: 'not found' });
      const ext = path.extname(full);
      const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon' }[ext] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      res.end(buf);
    });
    return;
  }

  // ---------- 1. 权限查询（给其他程序调用，无需登录） ----------
  if (p === '/api/check' && req.method === 'GET') {
    const app = (url.searchParams.get('app') || '').trim();
    if (!app) return json(res, 200, { ok: false, msg: '缺少 app 参数' });

    // ---- 设备模式（V1.15）：程序启动时上报本机 ----
    // 首次出现自动登记并授权；管理员在后台点「停用」后，同一设备立即被拦。
    // 设备标识由程序生成（计算机名 + 网卡 MAC 后 6 位），改名不影响统计。
    const did = (url.searchParams.get('device') || '').trim();
    if (did) {
      const now = today();
      const ip = clientIp(req);
      const name = (url.searchParams.get('name') || '').trim();
      const user = (url.searchParams.get('user') || '').trim();
      const osName = (url.searchParams.get('os') || '').trim();
      const ver = (url.searchParams.get('ver') || '').trim();

      let dev = data.devices.find(d => d.app === app && d.device === did);
      const first = !dev;
      if (first) {
        dev = {
          id: nextId(), app, device: did, name: name || did,
          user, os: osName, ver, ip,
          status: 'enabled', note: '', created: now, last: now, count: 1, auto: true,
        };
        data.devices.push(dev);
        save();
      } else {
        const touched = dev.last !== now;      // 时间戳按分钟，最多每分钟落盘一次
        dev.last = now;
        dev.count = (dev.count || 0) + 1;
        if (name) dev.name = name;
        if (user) dev.user = user;
        if (osName) dev.os = osName;
        if (ver) dev.ver = ver;
        if (ip) dev.ip = ip;
        if (touched) save();
      }

      const brief = { app, device: dev.name, device_id: dev.device };
      if (dev.status === 'disabled')
        return json(res, 200, Object.assign({
          ok: false, msg: '本机使用权限已被管理员停用（设备：' + dev.name + '）' }, brief));
      if (isExpired(dev.expires))
        return json(res, 200, Object.assign({
          ok: false, msg: '本机授权已过期（' + dev.expires + '）' }, brief));

      // 兼容：若后台单独为这个设备号建过授权码并停用，一并拦下
      const rec0 = data.records.find(r => r.app === app && r.code === did);
      if (rec0 && rec0.status === 'disabled')
        return json(res, 200, Object.assign({ ok: false, msg: '授权已停用' }, brief));

      return json(res, 200, Object.assign({
        ok: true, first, auto: true, count: dev.count,
        msg: first ? '首次使用，已自动授权' : '授权有效',
        owner: (rec0 && rec0.owner) || dev.user || '',
        expires: (rec0 && rec0.expires) || '永久',
      }, brief));
    }

    const code = (url.searchParams.get('code') || '').trim();
    if (!code) return json(res, 200, { ok: false, msg: '缺少 code 参数' });
    const rec = data.records.find(r => r.app === app && r.code === code);
    if (!rec) return json(res, 200, { ok: false, msg: '授权码不存在' });
    if (rec.status === 'disabled') return json(res, 200, { ok: false, msg: '授权已停用' });
    if (isExpired(rec.expires)) return json(res, 200, { ok: false, msg: '授权已过期（' + rec.expires + '）' });
    return json(res, 200, {
      ok: true, msg: '授权有效',
      app: rec.app, owner: rec.owner || '', expires: rec.expires || '永久',
    });
  }

  // ---------- 2. 消息反馈（给其他程序上报，无需登录） ----------
  if (p === '/api/feedback' && req.method === 'POST') {
    const b = await readBody(req);
    const content = String(b.content || '').trim();
    if (!content) return json(res, 200, { ok: false, msg: '反馈内容不能为空' });
    if (content.length > 2000) return json(res, 200, { ok: false, msg: '反馈内容过长' });
    data.feedback.unshift({
      id: nextId(),
      app: String(b.app || '').trim(),
      code: String(b.code || '').trim(),
      device: String(b.device || '').trim(),
      user: String(b.user || '').trim(),
      content,
      time: today(),
      read: false,
    });
    if (data.feedback.length > 500) data.feedback.length = 500;  // 最多留 500 条
    save();
    return json(res, 200, { ok: true, msg: '已收到' });
  }

  // ---------- 3. 管理端接口（需密码） ----------
  if (p.startsWith('/api/admin/')) {
    const pass = req.headers['x-admin-pass'] || url.searchParams.get('pass') || '';
    if (pass !== ADMIN_PASS) return json(res, 401, { ok: false, msg: '密码错误' });

    if (p === '/api/admin/records' && req.method === 'GET') {
      return json(res, 200, { ok: true, records: data.records });
    }

    if (p === '/api/admin/records' && req.method === 'POST') {
      const b = await readBody(req);
      const rec = {
        id: nextId(),
        app: String(b.app || '').trim(),
        code: String(b.code || '').trim(),
        owner: String(b.owner || '').trim(),
        expires: String(b.expires || '').trim(),   // YYYY-MM-DD 或空=永久
        note: String(b.note || '').trim(),
        status: b.status === 'disabled' ? 'disabled' : 'enabled',
        created: today(),
      };
      if (!rec.app || !rec.code) return json(res, 200, { ok: false, msg: '程序名和授权码必填' });
      const dup = data.records.find(r => r.app === rec.app && r.code === rec.code);
      if (dup) return json(res, 200, { ok: false, msg: '该程序下已有相同授权码' });
      data.records.push(rec);
      save();
      return json(res, 200, { ok: true, record: rec });
    }

    if (p === '/api/admin/records' && req.method === 'PUT') {
      const b = await readBody(req);
      const rec = data.records.find(r => r.id === b.id);
      if (!rec) return json(res, 200, { ok: false, msg: '记录不存在' });
      if (b.app !== undefined) rec.app = String(b.app).trim();
      if (b.code !== undefined) rec.code = String(b.code).trim();
      if (b.owner !== undefined) rec.owner = String(b.owner).trim();
      if (b.expires !== undefined) rec.expires = String(b.expires).trim();
      if (b.note !== undefined) rec.note = String(b.note).trim();
      if (b.status !== undefined) rec.status = b.status === 'disabled' ? 'disabled' : 'enabled';
      save();
      return json(res, 200, { ok: true, record: rec });
    }

    if (p === '/api/admin/records' && req.method === 'DELETE') {
      const b = await readBody(req);
      const n = data.records.length;
      data.records = data.records.filter(r => r.id !== b.id);
      if (data.records.length === n) return json(res, 200, { ok: false, msg: '记录不存在' });
      save();
      return json(res, 200, { ok: true });
    }

    // ---------- 设备管理（V1.15：程序启动自动上报，管理员可停用/删除） ----------
    if (p === '/api/admin/devices' && req.method === 'GET') {
      return json(res, 200, { ok: true, devices: data.devices });
    }

    if (p === '/api/admin/devices' && req.method === 'PUT') {
      const b = await readBody(req);
      const dev = data.devices.find(d => d.id === b.id);
      if (!dev) return json(res, 200, { ok: false, msg: '设备不存在' });
      if (b.status !== undefined) dev.status = b.status === 'disabled' ? 'disabled' : 'enabled';
      if (b.note !== undefined) dev.note = String(b.note).trim();
      if (b.name !== undefined && String(b.name).trim()) dev.name = String(b.name).trim();
      if (b.expires !== undefined) dev.expires = String(b.expires).trim();
      save();
      return json(res, 200, { ok: true, device: dev });
    }

    if (p === '/api/admin/devices' && req.method === 'DELETE') {
      const b = await readBody(req);
      const n = data.devices.length;
      if (b.all && b.all === 'disabled') {
        // 一键清掉所有已停用设备（被停用的机器下次启动会重新自动登记）
        data.devices = data.devices.filter(d => d.status !== 'disabled');
        if (data.devices.length === n) return json(res, 200, { ok: false, msg: '没有已停用的设备' });
        save();
        return json(res, 200, { ok: true, deleted: n - data.devices.length });
      }
      data.devices = data.devices.filter(d => d.id !== b.id);
      if (data.devices.length === n) return json(res, 200, { ok: false, msg: '设备不存在' });
      save();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/admin/feedback' && req.method === 'GET') {
      return json(res, 200, { ok: true, feedback: data.feedback });
    }
    if (p === '/api/admin/feedback' && req.method === 'PUT') {   // 标记已读
      const b = await readBody(req);
      const fb = data.feedback.find(f => f.id === b.id);
      if (!fb) return json(res, 200, { ok: false, msg: '不存在' });
      fb.read = true;
      save();
      return json(res, 200, { ok: true });
    }

    if (p === '/api/admin/feedback' && req.method === 'DELETE') {
      const b = await readBody(req);
      data.feedback = data.feedback.filter(f => f.id !== b.id);
      save();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { ok: false, msg: 'unknown admin api' });
  }

  json(res, 404, { ok: false, msg: 'unknown api' });
});

server.listen(PORT, () => {
  console.log(`信息平台已启动: http://localhost:${PORT}`);
});
