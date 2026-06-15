// ===================== 配置项 =====================
// API 走后端代理，不再暴露 Key
const API_BASE = '/api';
const STORAGE_KEY = 'pet_chatbot_data';
// ==================================================

// 全局变量
let conversationId = null;
let selectedFile = null; // 当前选中的文档

// DOM
const chatMessages = document.getElementById('chatMessages');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const quickBtns = document.querySelectorAll('.quick-btn');
const uploadBtn = document.getElementById('uploadBtn');
const fileInput = document.getElementById('fileInput');
const uploadModal = document.getElementById('uploadModal');
const closeModal = document.getElementById('closeModal');
const cancelUpload = document.getElementById('cancelUpload');
const dropArea = document.getElementById('dropArea');
const uploadFileShow = document.getElementById('uploadFileShow');
const newChatBtn = document.getElementById('newChatBtn');
const historyList = document.getElementById('historyList');

// ==================== 本地持久化 ====================
function saveToStorage() {
    const messages = [];
    chatMessages.querySelectorAll('.message').forEach(msg => {
        const isUser = msg.classList.contains('user-message');
        const content = msg.querySelector('.message-content')?.textContent || '';
        messages.push({ type: isUser ? 'user' : 'bot', content });
    });
    // 只保留最近 50 条，避免存储空间过大
    const trimmed = messages.slice(-50);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        conversationId,
        messages: trimmed,
        updatedAt: Date.now(),
    }));
}

function loadFromStorage() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return false;
        const data = JSON.parse(raw);
        if (!data.messages || data.messages.length === 0) return false;

        conversationId = data.conversationId || null;

        // 恢复消息
        chatMessages.innerHTML = '';
        data.messages.forEach(msg => {
            addMessage(msg.content, msg.type, false); // 不触发保存
        });
        return true;
    } catch (e) {
        return false;
    }
}

function clearStorage() {
    localStorage.removeItem(STORAGE_KEY);
}

// ==================== 提问记录面板 ====================
function addToHistory(question) {
    const empty = historyList.querySelector('.history-empty');
    if (empty) empty.remove();

    const item = document.createElement('div');
    item.className = 'history-item';
    item.innerHTML = `
        <span class="hi-icon">💬</span>
        <span class="hi-text">${escapeHtml(question)}</span>
    `;
    item.addEventListener('click', () => {
        userInput.value = question;
        userInput.focus();
    });
    historyList.prepend(item);

    // 限制记录数量
    if (historyList.children.length > 50) {
        historyList.lastElementChild.remove();
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== 新建对话 ====================
function newConversation(silent = false) {
    conversationId = null;
    removeFile();
    clearStorage();

    chatMessages.innerHTML = `
        <div class="message bot-message">
            <div class="avatar bot-avatar">🐱</div>
            <div class="message-content">
                你好！我是你的专属宠物智能顾问，有任何猫狗喂养、护理、疾病问题都可以问我~
            </div>
        </div>
    `;

    historyList.innerHTML = '<div class="history-empty">还没有提问~</div>';
    userInput.focus();

    if (!silent) {
        chatMessages.style.transition = 'background 0.15s';
        chatMessages.style.background = 'rgba(255, 255, 255, 0.5)';
        setTimeout(() => {
            chatMessages.style.background = 'transparent';
        }, 200);
    }
}

newChatBtn.addEventListener('click', () => newConversation());

// ==================== 快捷问题 ====================
quickBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        userInput.value = btn.dataset.question;
        sendMessage();
    });
});

// ==================== 文件上传弹窗 ====================
uploadBtn.addEventListener('click', () => {
    uploadModal.classList.add('show');
});

[closeModal, cancelUpload].forEach(el => {
    el.addEventListener('click', () => {
        uploadModal.classList.remove('show');
    });
});

dropArea.addEventListener('click', () => {
    fileInput.click();
});

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) handleFile(file);
});

// 拖拽
['dragenter','dragover','dragleave','drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
});
function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter','dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.add('active'));
});
['dragleave','drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.remove('active'));
});

dropArea.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
});

function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const allowExt = ['txt','pdf','doc','docx','md'];

    if (!allowExt.includes(ext)) {
        alert('仅支持 TXT / PDF / DOC / DOCX / MD 格式');
        return;
    }

    if (file.size > 10 * 1024 * 1024) {
        alert('文件大小不能超过 10MB');
        return;
    }

    selectedFile = file;
    renderFileItem(file);
    uploadModal.classList.remove('show');
}

function renderFileItem(file) {
    uploadFileShow.innerHTML = `
        <div class="file-item">
            <div class="file-name">
                <i class="fas fa-file-alt"></i>
                <span>${escapeHtml(file.name)}</span>
            </div>
            <i class="fas fa-times del-file" onclick="removeFile()"></i>
        </div>
    `;
}

window.removeFile = function() {
    selectedFile = null;
    fileInput.value = '';
    uploadFileShow.innerHTML = '';
}

// ==================== 发送消息 ====================
async function sendMessage() {
    const message = userInput.value.trim();
    if (!message && !selectedFile) return;

    sendBtn.disabled = true;
    userInput.disabled = true;
    uploadBtn.disabled = true;

    // 展示用户消息
    let showText = message;
    if (selectedFile) {
        showText += `\n【附带文档】${selectedFile.name}`;
    }
    addMessage(showText, 'user');
    addToHistory(message);
    userInput.value = '';

    const loadingId = addLoadingMessage();

    try {
        // 准备请求体
        const body = {
            inputs: {},
            query: message,
            conversation_id: conversationId,
            user: 'pet-chatbot-user',
        };

        // 如果有文件，读取为 base64 传给后端代理
        if (selectedFile) {
            const fileBase64 = await readFileAsBase64(selectedFile);
            body.files = [{
                type: 'document',
                transfer_method: 'local_file',
                upload_file_id: await uploadFileToProxy(selectedFile, fileBase64),
            }];
        }

        const response = await fetch(`${API_BASE}/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });

        removeMessage(loadingId);
        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.error || '请求异常');
        }

        // 流式解析
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let botMessage = '';
        const botMessageId = addMessage('...', 'bot');

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(line => line.trim() !== '');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.substring(6));
                        if (!conversationId && data.conversation_id) {
                            conversationId = data.conversation_id;
                            saveToStorage();
                        }
                        // Chatbot 模式：event: message 带 answer 字段
                        if (data.answer) {
                            botMessage += data.answer;
                            updateMessage(botMessageId, botMessage);
                        }
                        // Workflow 完成
                        if (data.event === 'workflow_finished') {
                            if (data.data?.status === 'failed') {
                                if (!botMessage) {
                                    botMessage = '抱歉，AI 处理出错了：' + (data.data?.error || '未知错误');
                                    updateMessage(botMessageId, botMessage);
                                }
                            }
                        }
                    } catch (e) {
                        console.error('[Parse Error]', e, line);
                    }
                }
            }
        }

        // 如果流式结束没收到内容
        if (!botMessage) {
            updateMessage(botMessageId, '抱歉，没有收到回复，请重试~');
        }

        // 机器人回复完毕后保存
        saveToStorage();

    } catch (error) {
        console.error('[Send Error]', error);
        removeMessage(loadingId);
        addMessage('抱歉，服务暂时出现问题，请稍后再试~', 'bot');
        saveToStorage();
    } finally {
        sendBtn.disabled = false;
        userInput.disabled = false;
        uploadBtn.disabled = false;
        userInput.focus();
        removeFile();
    }
}

// ==================== 文件处理 ====================
// 通过代理上传文件到 Dify，返回 file_id
async function uploadFileToProxy(file, base64) {
    const response = await fetch(`${API_BASE}/file-upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            file_base64: base64,
            file_name: file.name,
            mime_type: file.type || 'application/octet-stream',
            user: 'pet-chatbot-user',
        }),
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || '文件上传失败');
    }

    const data = await response.json();
    return data.id;
}

function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            // 去掉 data:xxx;base64, 前缀
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// ==================== 消息 DOM 操作 ====================
function addMessage(text, type, doSave = true) {
    const id = Date.now() + Math.random();
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    messageDiv.id = `msg-${id}`;

    const avatar = document.createElement('div');
    avatar.className = `avatar ${type}-avatar`;
    avatar.textContent = type === 'bot' ? '🐱' : '👤';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = text;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (doSave) saveToStorage();
    return id;
}

function addLoadingMessage() {
    const id = Date.now() + Math.random();
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    messageDiv.id = `msg-${id}`;

    const avatar = document.createElement('div');
    avatar.className = 'avatar bot-avatar';
    avatar.textContent = '🐱';

    const content = document.createElement('div');
    content.className = 'message-content';
    content.innerHTML = `
        <div class="loading-dots">
            <span></span>
            <span></span>
            <span></span>
        </div>
    `;

    messageDiv.appendChild(avatar);
    messageDiv.appendChild(content);
    chatMessages.appendChild(messageDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return id;
}

function updateMessage(id, text) {
    const messageDiv = document.getElementById(`msg-${id}`);
    if (messageDiv) {
        const content = messageDiv.querySelector('.message-content');
        content.textContent = text;
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

function removeMessage(id) {
    const messageDiv = document.getElementById(`msg-${id}`);
    if (messageDiv) messageDiv.remove();
}

// ==================== 事件监听 ====================
userInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !sendBtn.disabled) {
        sendMessage();
    }
});

sendBtn.addEventListener('click', sendMessage);

// ==================== 启动：尝试恢复上次会话 ====================
(function init() {
    const restored = loadFromStorage();
    if (!restored) {
        // 无历史记录，显示欢迎页
        saveToStorage();
    }
})();
