# 信息平台

自研程序（日报工具等）的**云端授权 + 消息反馈**后台。一个 Node 服务搞定，无第三方依赖。

## 功能

| 功能 | 说明 |
|---|---|
| 授权管理 | 网页后台增删授权记录（程序名 + 授权码 + 授权对象 + 到期日），一键启用/停用 |
| 权限校验 | 程序启动时调 `/api/check`，返回授权是否有效、到期时间 |
| 设备管理 | 程序启动时上报设备名（计算机名），首次自动登记并放行；管理员可停用某台机器 |
| 消息反馈 | 程序内用户提交反馈，调 `/api/feedback` 上报，后台可查看/标已读/删除 |

## 设备授权（V1.15，推荐用法）

程序启动时把本机信息上报，平台**第一次收到就自动授权**，你只需要在事后收紧：

1. 程序生成设备标识：`计算机名-MAC后6位`（如 `JSZT-PC01-a1b2c3`，改名也能认出来）
2. 调 `/api/check?app=…&device=…&name=…&user=…&os=…&ver=…`
3. 平台自动写进「设备管理」：设备名 / 用户 / 系统 / 版本 / IP / 首次 / 最近 / 累计次数
4. 要限制某台机器：后台点「停用」→ 那台机器下次启动弹窗提示并退出
5. 断网、平台连不上时程序**照常可用**（fail-open），只有明确「已停用/已过期」才拦

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

{"app": "日报工具", "code": "授权码", "device": "设备名", "user": "张三", "content": "反馈内容"}
```

最多保留最近 500 条。

## 管理后台

浏览器打开平台首页，输入管理密码登录。密码放在同目录 `config.local.json`（`{"ADMIN_PASS": "..."}`），
该文件不进仓库（已 gitignore），改完密码重新部署即可生效。

- **授权管理**：新增/编辑/删除授权，改完点「保存」即时生效；「到期日」留空 = 永久
- **设备管理**：程序自动上报的设备，可停用/启用/备注；停用后该机器下次启动被拦
- **消息反馈**：看用户上报的消息，蓝色「新」标未读

## 数据

- 服务端同目录 `data.json`，每次改动原子落盘
- 部署在 WorkBuddy 站点时数据随应用保存；重要数据建议定期在后台导出备份

## 本地运行

```bash
node server.js        # 默认 http://localhost:3000，可用 PORT 环境变量改端口
```
