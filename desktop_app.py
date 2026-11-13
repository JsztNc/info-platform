#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""信息平台 桌面管理端 V1.12

脱离网页：双击 exe 就是管理窗口，数据全部在云端，换任何 Windows 电脑
双击就能用（Win10/11 自带 .NET，无需装 Python）。
  - 授权管理：新增 / 保存 / 停用·启用 / 删除 / 刷新
  - 消息反馈：查看 / 标已读 / 删除，未读数显示在页签标题上

平台地址写死在 CONFIG 区，要换地址改这一处重新打包即可。
自检模式：信息平台.exe --selftest [密码]  会把结果写到 exe 旁的 selftest.txt
"""
import json
import os
import sys
import threading
import urllib.request

import clr  # pythonnet
clr.AddReference("System.Windows.Forms")
clr.AddReference("System.Drawing")
from System import Action
from System.Drawing import Color, FontStyle, Font, Point, Size
from System.Windows.Forms import (
    Application, DialogResult, DataGridViewSelectionMode, FormBorderStyle, FlatStyle,
    Button, DataGridView, DataGridViewTextBoxColumn, Form, FormStartPosition, Label, ListView,
    ListViewItem, MessageBox, MessageBoxButtons, Panel, TabControl, TabPage,
    TextBox, View,
)

# ================= CONFIG =================
PLATFORM_URL = "https://info-platform.app.workbuddy.host"
SHARECODE = "KC4MIHDOVT"
APP_VER = "1.12"
TIMEOUT = 15

C_BLUE = Color.FromArgb(31, 111, 235)
C_GREEN = Color.FromArgb(23, 161, 90)
C_RED = Color.FromArgb(229, 83, 75)
C_PURPLE = Color.FromArgb(136, 84, 208)
C_GRAY = Color.FromArgb(120, 126, 136)


# ================= 云端调用 =================
def api(path, method="GET", body=None, password=None):
    """调云端接口。失败抛异常，成功返回 dict。"""
    url = "%s%s?sharecode=%s" % (PLATFORM_URL, path, SHARECODE)
    headers = {"Content-Type": "application/json",
               "User-Agent": "info-platform-desktop/%s" % APP_VER}
    if password:
        headers["x-admin-pass"] = password
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def check_conn(password):
    """探一次授权列表。返回 (True, records) 或 (False, 原因)。"""
    try:
        r = api("/api/admin/records", password=password)
        if r.get("ok"):
            return True, r.get("records", [])
        return False, r.get("msg") or "密码错误"
    except Exception as e:
        return False, "网络错误：%s" % e


# ================= 控件工具 =================
def mk_label(text, x, y, size=10, color=None):
    lb = Label()
    lb.Text = text
    lb.Location = Point(x, y)
    lb.AutoSize = True
    lb.Font = Font("Microsoft YaHei", float(size))
    if color:
        lb.ForeColor = color
    return lb


def mk_button(text, x, y, w, h, color=None, size=10):
    b = Button()
    b.Text = text
    b.Location = Point(x, y)
    b.Size = Size(w, h)
    b.Font = Font("Microsoft YaHei", float(size))
    b.FlatStyle = FlatStyle.Flat
    if color:
        b.BackColor = color
        b.ForeColor = Color.White
        b.FlatAppearance.BorderSize = 0
    return b


def mk_text(x, y, w, password=False):
    tb = TextBox()
    tb.Location = Point(x, y)
    tb.Size = Size(w, 26)
    tb.Font = Font("Microsoft YaHei", 10.0)
    if password:
        tb.UseSystemPasswordChar = True
    return tb


def status_of(rec):
    """记录 -> (状态文字, 是否有效)"""
    if rec.get("status") == "disabled":
        return "停用", False
    exp = rec.get("expires") or ""
    if exp:
        try:
            import datetime
            if datetime.datetime.strptime(exp, "%Y-%m-%d") < datetime.datetime.now() - datetime.timedelta(days=1):
                return "已过期", False
        except ValueError:
            pass
    return "有效", True


# ================= 登录窗口 =================
def open_login():
    dlg = Form()
    dlg.Text = "信息平台 V%s · 管理登录" % APP_VER
    dlg.ClientSize = Size(360, 168)
    dlg.FormBorderStyle = FormBorderStyle.FixedSingle
    dlg.MaximizeBox = False
    dlg.MinimizeBox = False
    dlg.StartPosition = FormStartPosition.CenterScreen

    dlg.Controls.Add(mk_label("信息平台 · 管理登录", 24, 20, size=13))
    dlg.Controls.Add(mk_label("管理密码（同网页后台密码）", 24, 62, size=9, color=C_GRAY))
    tb = mk_text(24, 84, 240, password=True)
    dlg.Controls.Add(tb)
    lbMsg = mk_label("", 24, 122, size=9, color=C_RED)
    dlg.Controls.Add(lbMsg)

    def do_login(sender, args):
        pwd = tb.Text.strip()
        if not pwd:
            lbMsg.Text = "请输入密码"
            return
        lbMsg.Text = "连接云端…"
        dlg.Enabled = False

        def work():
            ok, result = check_conn(pwd)

            def back():
                dlg.Enabled = True
                if ok:
                    dlg.Tag = (pwd, result)
                    dlg.DialogResult = DialogResult.OK
                    dlg.Close()
                else:
                    lbMsg.Text = str(result)

            dlg.BeginInvoke(Action(back))

        threading.Thread(target=work, daemon=True).start()

    b = mk_button("登 录", 276, 84, 60, 26, color=C_BLUE)
    b.Click += do_login
    dlg.Controls.Add(b)
    dlg.AcceptButton = b
    return dlg


# ================= 主窗口 =================
def open_main(password):
    form = Form()
    form.Text = "信息平台 V%s" % APP_VER
    form.ClientSize = Size(920, 600)
    form.StartPosition = FormStartPosition.CenterScreen

    tabs = TabControl()
    tabs.Location = Point(8, 8)
    tabs.Size = Size(904, 584)
    form.Controls.Add(tabs)

    # ---------------- 通用后台任务 ----------------
    def bg(form_ref, fn, done, busy_text):
        form_ref.UseWaitCursor = True
        form_ref.Text = "信息平台 V%s — %s" % (APP_VER, busy_text)

        def work():
            try:
                res = fn()
                err = None
            except Exception as e:
                res, err = None, str(e)

            def back():
                form_ref.UseWaitCursor = False
                form_ref.Text = "信息平台 V%s" % APP_VER
                if err:
                    MessageBox.Show(form_ref, str(err), "出错")
                else:
                    try:
                        done(res)
                    except Exception:
                        pass

            form_ref.BeginInvoke(Action(back))

        threading.Thread(target=work, daemon=True).start()

    def reload_all():
        """重新拉授权+反馈"""
        def work():
            return api("/api/admin/records", password=password), api("/api/admin/feedback", password=password)

        def done(res):
            fill_grid(res[0].get("records", []))
            fill_feedback(res[1].get("feedback", []))

        bg(form, work, done, "刷新中…")

    # ================= 页签1：授权管理 =================
    page1 = TabPage()
    page1.Text = "授权管理"
    tabs.TabPages.Add(page1)

    grid = DataGridView()
    grid.Location = Point(10, 12)
    grid.Size = Size(876, 470)
    grid.AllowUserToAddRows = False
    grid.AllowUserToDeleteRows = False
    grid.RowHeadersVisible = False
    grid.SelectionMode = DataGridViewSelectionMode.FullRowSelect
    grid.BackgroundColor = Color.White
    grid.Font = Font("Microsoft YaHei", 9.5)
    cols = [("app", "程序名", 130, False), ("code", "授权码", 170, False),
            ("owner", "授权给", 100, False), ("expires", "到期日", 100, False),
            ("note", "备注", 180, False), ("status", "状态", 70, True),
            ("created", "创建时间", 120, True)]
    for key, title, w, ro in cols:
        c = DataGridViewTextBoxColumn()
        c.Name = key
        c.HeaderText = title
        c.Width = w
        c.ReadOnly = ro
        c.MaxInputLength = 200
        grid.Columns.Add(c)
    page1.Controls.Add(grid)

    def fill_grid(records):
        grid.Rows.Clear()
        for r in records:
            i = grid.Rows.Add()
            row = grid.Rows[i]
            row.Cells[0].Value = r.get("app", "")
            row.Cells[1].Value = r.get("code", "")
            row.Cells[2].Value = r.get("owner", "")
            row.Cells[3].Value = r.get("expires", "")
            row.Cells[4].Value = r.get("note", "")
            st, _ = status_of(r)
            row.Cells[5].Value = st
            row.Cells[6].Value = r.get("created", "")
            row.Tag = r

    def cur_row():
        return grid.CurrentRow

    def on_add(sender, args):
        def work():
            return api("/api/admin/records", "POST",
                       {"app": "新程序", "code": "NEW-%04d" % (len(str(id(form))) % 10000)}, password=password)

        def done(res):
            reload_all()
            MessageBox.Show(form, "已新增一条「新程序」，改好内容后选中它点「保存选中」", "提示")

        bg(form, work, done, "新增中…")

    def on_save(sender, args):
        row = cur_row()
        if row is None:
            return
        rec = row.Tag
        body = {"id": rec["id"],
                "app": (row.Cells[0].Value or "").strip(),
                "code": (row.Cells[1].Value or "").strip().upper(),
                "owner": (row.Cells[2].Value or "").strip(),
                "expires": (row.Cells[3].Value or "").strip(),
                "note": (row.Cells[4].Value or "").strip()}
        if not body["app"] or not body["code"]:
            MessageBox.Show(form, "程序名和授权码不能为空", "提示")
            return

        def work():
            return api("/api/admin/records", "PUT", body, password=password)

        def done(res):
            if res.get("ok"):
                reload_all()
            else:
                MessageBox.Show(form, res.get("msg", "保存失败"), "提示")

        bg(form, work, done, "保存中…")

    def on_toggle(sender, args):
        row = cur_row()
        if row is None:
            return
        rec = row.Tag
        new_status = "enabled" if rec.get("status") == "disabled" else "disabled"

        def work():
            return api("/api/admin/records", "PUT", {"id": rec["id"], "status": new_status}, password=password)

        def done(res):
            reload_all()

        bg(form, work, done, "切换状态…")

    def on_del(sender, args):
        row = cur_row()
        if row is None:
            return
        rec = row.Tag
        if MessageBox.Show(form, "确定删除「%s / %s」？删掉后该授权码立即失效。"
                           % (rec.get("app"), rec.get("code")),
                           "确认删除", MessageBoxButtons.YesNo) != DialogResult.Yes:
            return

        def work():
            return api("/api/admin/records", "DELETE", {"id": rec["id"]}, password=password)

        def done(res):
            reload_all()

        bg(form, work, done, "删除中…")

    y = 492
    btns = [
        mk_button("＋ 新增授权", 10, y, 120, 34, color=C_BLUE),
        mk_button("保存选中", 140, y, 104, 34, color=C_GREEN),
        mk_button("停用/启用", 254, y, 104, 34, color=C_PURPLE),
        mk_button("删除选中", 368, y, 104, 34, color=C_RED),
        mk_button("刷新", 782, y, 104, 34, color=None),
    ]
    btns[0].Click += on_add
    btns[1].Click += on_save
    btns[2].Click += on_toggle
    btns[3].Click += on_del
    btns[4].Click += lambda s, a: reload_all()
    for b in btns:
        page1.Controls.Add(b)
    page1.Controls.Add(mk_label("改完单元格后点「保存选中」；到期日格式 2026-12-31，留空 = 永久", 10, y + 40,
                                size=9, color=C_GRAY))

    # ================= 页签2：消息反馈 =================
    page2 = TabPage()
    page2.Text = "消息反馈"
    tabs.TabPages.Add(page2)

    lv = ListView()
    lv.Location = Point(10, 12)
    lv.Size = Size(876, 470)
    lv.View = View.Details
    lv.FullRowSelect = True
    lv.GridLines = True
    lv.Font = Font("Microsoft YaHei", 9.5)
    for title, w in [("时间", 120), ("程序", 110), ("用户", 90), ("授权码", 150), ("内容", 330), ("状态", 60)]:
        ch = lv.Columns.Add(title, w)
    page2.Controls.Add(lv)

    def fill_feedback(items):
        lv.Items.Clear()
        unread = 0
        for f in items:
            it = ListViewItem([f.get("time", ""), f.get("app", ""), f.get("user", "匿名"),
                               f.get("code", ""), f.get("content", ""),
                               "已读" if f.get("read") else "新"])
            it.Tag = f
            lv.Items.Add(it)
            if not f.get("read"):
                unread += 1
        page2.Text = "消息反馈%s" % ((" (%d)" % unread) if unread else "")

    def fb_cur():
        return lv.SelectedItems[0] if lv.SelectedItems.Count else None

    def fb_read(sender, args):
        it = fb_cur()
        if it is None:
            return
        f = it.Tag
        if f.get("read"):
            return

        def work():
            return api("/api/admin/feedback", "PUT", {"id": f["id"]}, password=password)

        def done(res):
            reload_all()

        bg(form, work, done, "标记中…")

    def fb_del(sender, args):
        it = fb_cur()
        if it is None:
            return
        f = it.Tag
        if MessageBox.Show(form, "删除这条反馈？", "确认", MessageBoxButtons.YesNo) != DialogResult.Yes:
            return

        def work():
            return api("/api/admin/feedback", "DELETE", {"id": f["id"]}, password=password)

        def done(res):
            reload_all()

        bg(form, work, done, "删除中…")

    y2 = 492
    fb_btns = [
        mk_button("刷新", 10, y2, 104, 34, color=C_BLUE),
        mk_button("标为已读", 124, y2, 104, 34, color=C_GREEN),
        mk_button("删除", 238, y2, 104, 34, color=C_RED),
    ]
    fb_btns[0].Click += lambda s, a: reload_all()
    fb_btns[1].Click += fb_read
    fb_btns[2].Click += fb_del
    for b in fb_btns:
        page2.Controls.Add(b)

    form.Shown += lambda s, a: reload_all()
    return form


# ================= 自检模式（exe 测试用） =================
def selftest(pwd):
    out = ["信息平台桌面端 V%s 自检" % APP_VER, "平台: %s" % PLATFORM_URL]
    ok, res = check_conn(pwd or "x")
    out.append("连接/鉴权: %s" % ("OK, %d 条授权" % len(res) if ok else res))
    if ok:
        try:
            r = api("/api/admin/feedback", password=pwd)
            out.append("反馈接口: OK, %d 条" % len(r.get("feedback", [])))
        except Exception as e:
            out.append("反馈接口: %s" % e)
    dst = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), "selftest.txt")
    with open(dst, "w", encoding="utf-8") as f:
        f.write("\n".join(out))
    print("\n".join(out))


def main():
    if "--selftest" in sys.argv:
        idx = sys.argv.index("--selftest")
        pwd = sys.argv[idx + 1] if len(sys.argv) > idx + 1 else ""
        selftest(pwd)
        return
    try:
        Application.EnableVisualStyles()
        login = open_login()
        # 注意：pythonnet 下 EnableVisualStyles 之后 ShowDialog() 会瞬间自动返回，
        # 窗口一闪就退（V1.11 打不开的根因）。必须走 Application.Run。
        Application.Run(login)
        if login.DialogResult == DialogResult.OK:
            pwd, _records = login.Tag
            Application.Run(open_main(pwd))
    except Exception:
        # 兜底：任何启动失败都落一份日志在 exe 旁边，杜绝"无声退出"没法排查
        import traceback
        import datetime
        dst = os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])),
                           "启动错误日志.txt")
        with open(dst, "a", encoding="utf-8") as f:
            f.write("\n[%s]\n%s\n" % (
                datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                traceback.format_exc()))
        raise


if __name__ == "__main__":
    main()
