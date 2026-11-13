# 信息平台

自研程序（日报工具等）的**云端授权 + 消息反馈**后台。一个 Node 服务搞定，无第三方依赖。

## 功能

| 功能 | 说明 |
|---|---|
| 授权管理 | 网页后台增删授权记录（程序名 + 授权码 + 授权对象 + 到期日），一键启用/停用 |
| 权限校验 | 程序启动时调 `/api/check`，返回授权是否有效、到期时间 |
| 消息反馈 | 程序内用户提交反馈，调 `/api/feedback` 上报，后台可查看/标已读/删除 |

## 其他程序接入

> 平台地址：`https://info-platform.app.workbuddy.host`（**所有请求都要带 `sharecode=KC4MIHDOVT`**）

### 1. 查询权限（GET，无需登录）

```
GET https://info-platform.app.workbuddy.host/api/check?app=日报工具&code=授权码&sharecode=KC4MIHDOVT
```

返回：

```json
{"ok": true, "msg": "授权有效", "app": "日报工具", "owner": "张三", "expires": "2026-12-31"}
{"ok": false, "msg": "授权已停用"}
{"ok": false, "msg": "授权已过期（2026-12-31）"}
{"ok": false, "msg": "授权码不存在"}
```

Python 示例：

```python
import requests
r = requests.get(PLATFORM_URL + "/api/check", params={"app": "日报工具", "code": code}, timeout=10).json()
if not r.get("ok"):
    print("未授权：", r.get("msg"))
```

### 2. 上报反馈（POST，无需登录）

```
POST https://info-platform.app.workbuddy.host/api/feedback?sharecode=KC4MIHDOVT
Content-Type: application/json

{"app": "日报工具", "code": "授权码", "user": "张三", "content": "反馈内容"}
```

最多保留最近 500 条。

## 管理后台

浏览器打开平台首页，输入管理密码登录（密码在 `server.js` 顶部 `ADMIN_PASS`，改完需重新部署）。

- **授权管理**：新增/编辑/删除授权，改完点「保存」即时生效；「到期日」留空 = 永久
- **消息反馈**：看用户上报的消息，蓝色「新」标未读

## 数据

- 服务端同目录 `data.json`，每次改动原子落盘
- 部署在 WorkBuddy 站点时数据随应用保存；重要数据建议定期在后台导出备份

## 本地运行

```bash
node server.js        # 默认 http://localhost:3000，可用 PORT 环境变量改端口
```
