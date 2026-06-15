// ===================== 宠物智能顾问 - API 代理服务 =====================
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== 配置 ====================
const DIFY_API_KEY = process.env.DIFY_API_KEY || '';
const DIFY_API_BASE = process.env.DIFY_API_BASE || 'https://api.dify.ai/v1';

// ==================== 安全中间件 ====================
app.use(helmet({
    contentSecurityPolicy: false, // 允许加载 Font Awesome CDN
}));

// CORS — 生产环境可限制域名
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '*';
app.use(cors({
    origin: ALLOWED_ORIGIN,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

// 请求体大小限制 (含文件上传 base64)
app.use(express.json({ limit: '15mb' }));

// 速率限制 — 防止滥用
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 每分钟
    max: 30,
    message: { error: '请求过于频繁，请稍后再试~' },
});
app.use('/api/', limiter);

// ==================== 健康检查 ====================
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ==================== 聊天代理 (流式) ====================
app.post('/api/chat', async (req, res) => {
    try {
        const { query, conversation_id, inputs = {}, user = 'pet-chatbot-user', files } = req.body;

        if (!query && (!files || files.length === 0)) {
            return res.status(400).json({ error: '请输入问题或上传文件' });
        }

        const difyBody = {
            inputs,
            query: query || '',
            response_mode: 'streaming',
            conversation_id: conversation_id || undefined,
            user,
        };

        // 如果有文件，传给 Dify
        if (files && files.length > 0) {
            difyBody.files = files;
        }

        const response = await fetch(`${DIFY_API_BASE}/chat-messages`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(difyBody),
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[Dify Error]', response.status, errText);
            return res.status(response.status).json({
                error: 'AI 服务暂时不可用，请稍后再试~',
            });
        }

        // 流式透传
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no'); // nginx 兼容

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            res.write(chunk);
        }

        res.end();
    } catch (error) {
        console.error('[Proxy Error]', error.message);
        if (!res.headersSent) {
            res.status(500).json({ error: '服务异常，请稍后再试~' });
        }
    }
});

// ==================== 文件上传代理 ====================
app.post('/api/file-upload', async (req, res) => {
    try {
        const { file_base64, file_name, mime_type, user = 'pet-chatbot-user' } = req.body;

        if (!file_base64 || !file_name) {
            return res.status(400).json({ error: '缺少文件信息' });
        }

        const formData = new FormData();
        // 将 base64 转为 Blob
        const binary = Buffer.from(file_base64, 'base64');
        const blob = new Blob([binary], { type: mime_type || 'application/octet-stream' });
        formData.append('file', blob, file_name);
        formData.append('user', user);

        const response = await fetch(`${DIFY_API_BASE}/files/upload`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${DIFY_API_KEY}`,
            },
            body: formData,
        });

        if (!response.ok) {
            const errText = await response.text();
            console.error('[Dify File Error]', response.status, errText);
            return res.status(response.status).json({ error: '文件上传失败' });
        }

        const data = await response.json();
        res.json(data);
    } catch (error) {
        console.error('[File Proxy Error]', error.message);
        res.status(500).json({ error: '文件上传服务异常' });
    }
});

// ==================== 生产模式：托管前端静态文件 ====================
// 优先同目录（Docker），否则父目录（本地开发）
const staticDir = (() => {
    const sameDir = __dirname;
    const parentDir = path.join(__dirname, '..');
    try { require('fs').accessSync(path.join(sameDir, 'index.html')); return sameDir; } catch (e) {}
    try { require('fs').accessSync(path.join(parentDir, 'index.html')); return parentDir; } catch (e) {}
    return parentDir;
})();

app.use(express.static(staticDir, {
    index: 'index.html',
    maxAge: '1h',
}));

// SPA fallback
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        res.sendFile(path.join(staticDir, 'index.html'));
    }
});

// ==================== 启动 ====================
app.listen(PORT, () => {
    console.log(`🐾 宠物智能顾问代理服务已启动`);
    console.log(`   地址: http://localhost:${PORT}`);
    console.log(`   API:  http://localhost:${PORT}/api/chat`);
    console.log(`   Dify: ${DIFY_API_BASE}`);
    console.log(`   Key:  ${DIFY_API_KEY ? DIFY_API_KEY.substring(0, 8) + '...' : '⚠️ 未配置'}`);
});
