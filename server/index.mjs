import { createApp, envValues } from './app.mjs'

const PORT = Number(process.env.PORT || envValues().PORT || 8787)
const app = createApp({ serveStatic: true })
const cfg = app.getConfig()

app.listen(PORT, () => {
  console.log(`[server] 分镜代理服务已启动: http://localhost:${PORT}`)
  console.log(`[server] 模型: ${cfg.model}  接口: ${cfg.baseUrl}`)
  console.log(`[server] API Key: ${cfg.hasKey ? '已配置 ✓' : '未配置 ✗ （在界面「设置」里填写即可）'}`)
})
