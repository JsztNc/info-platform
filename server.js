#!/usr/bin/env node
/**
 * 信息平台 — 江苏中天自研程序的云端授权 + 消息反馈后台
 *
 * 功能：
 *   1) 权限查询接口  GET  /api/check?app=程序名&code=授权码
 *      -> {"ok":true,"app":"日报工具","owner":"张三","expires":"2026-12-31","msg":"授权有效"}
 *   2) 消息反馈接口  POST /api/feedback  {app, code, user, content}
 *      -> {"ok":true}   管理端后台可查看、标记已读、删除
 *   3) 管理端       /      密码登录后管理授权记录与反馈
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

// ============ 配置（要改密码就改这里） ============
const ADMIN_PASS = 'REDACTED';          // 管理端登录密码
const DATA_FILE = path.join(__dirname, 'data.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 3000);

// ============ 数据存取 ============
let data = { records: [], feedback: [], seq: 1 };

function load() {
  try {
    data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(data.records)) data.records = [];
    if (!Array.isArray(data.feedback)) data.feedback = [];
    if (!data.seq) data.seq = 1;
  } catch (e) {
    // 首次运行或文件损坏：用默认空数据，不覆盖已有文件内容为空时才初始化
    data = { records: [], feedback: [], seq: 1 };
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
    const code = (url.searchParams.get('code') || '').trim();
    if (!app || !code) return json(res, 200, { ok: false, msg: '缺少 app 或 code 参数' });
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
