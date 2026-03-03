# PhotoRank AI 📸

[🌍 Read this in English](README.md)

**由 AI 驱动的专业摄影选片与画质增强工具**

PhotoRank AI 帮助摄影师自动化处理从数千张照片中挑选最佳镜头的繁琐过程。导入文件夹，让 AI 引擎为每张照片打分，然后对您最满意的照片进行画质增强——所有评分过程**均在你的本地设备上运行**。

![screenshot](docs/landing.png)

---

## ✨ 核心功能

### 🎯 AI 自动选片打分
- **本地 AI 评分** — NIMA 和 CLIP 模型直接在你的机器上运行（无需云端 API）
- **多维度分析** — 综合分析构图、光照、技术质量与美学表现
- **批量处理** — 借助 GPU 加速，几分钟内即可完成数百张照片的打分
- **RRF 排序融合** — 结合 NIMA 和 CLIP 两种排名，提供绝对可靠的评分准则

### 🌍 多语言 UI & 灵活的 AI 服务商
- **i18n 多语言** — 中文（简体）与英文界面无缝切换。
- **多家头部 AI 模型** — 支持使用 **Google Gemini** 或 **阿里千问 (Qwen)** 进行照片画质增强。
- **智能降级保护** — 主模型如果触及速率限制或服务器繁忙，会自动降级使用备用模型。

### 🖼️ 支持的图片格式
| 类型 | 格式 |
|------|---------|
| **标准格式** | JPG, JPEG, PNG, WEBP, AVIF, TIFF, BMP |
| **RAW 格式** | CR2, CR3 (Canon), NEF (Nikon), ARW (Sony), DNG, RAF (Fuji), ORF (Olympus), RW2 (Panasonic) |

### 🎨 两种画质增强模式
| 模式 | 速度 | 工作原理 |
|------|-------|--------------|
| **极速 (Fast)** 🔵 | ~25秒 | AI 快速评估并直接生成增强版本（Gemini / 千问） |
| **专业 (Pro)** 🟣 | ~2分钟 | AI 多轮迭代审查与画质深度精修 |

<p align="center">
  <img src="docs/before.png" width="45%" alt="增强前" />
  <img src="docs/after.png" width="45%" alt="增强后" />
</p>
<p align="center"><em>Before → After: 一键 AI 增强演示</em></p>

### 🔍 智能体验
- **连拍检测 (Burst Detection)** — 利用 CLIP 向量自动将视觉相似的连拍照片分组折叠
- **高清导出 (Batch Export)** — 导出所选照片，增强后的高清大图会直接保存到你的本地磁盘。

### 🔒 隐私优先
- 所有选片打分过程均在 **本地** 物理机运行
- 评分时，你的照片数据绝不会离开你的电脑
- 只有触发“画质增强”功能时，才会调用设定的 API (Gemini 或 DashScope)，并通过安全信道处理。

---

## 💻 系统需求

### 最低配置要求
| 组件 | 需求 |
|-----------|-------------|
| **操作系统** | macOS 12+, Windows 10+, 或 Linux (Ubuntu 20.04+) |
| **处理器 (CPU)** | 64 位处理器, 推荐 4 核心以上 |
| **内存 (RAM)** | 最低 **8 GB** (推荐 16 GB) |
| **硬盘空间** | ~3 GB (用于存放 AI 模型及依赖) |
| **Node.js** | v18 或更高版本 |
| **Python** | 3.9 – 3.12 |
| **pip** | 建议使用最新版本 |

### 🚀 GPU 加速 (强烈推荐)

拥有 GPU 将大幅加快选片速度 — 比纯 CPU **快 5–10 倍**。

| 平台 | 运行时后端 | 备注 |
|----------|---------|-------|
| **Apple Silicon** (M1/M2/M3/M4) | MPS (Metal) | ✅ 自动识别并开启，无需配置 |
| **NVIDIA** (GTX 1060+) | CUDA 11.8+ | 需要安装 [支持 CUDA 的 PyTorch](https://pytorch.org/get-started/locally/) |
| **纯 CPU** | — | 可以运行，但速度慢（约 5秒/张 vs GPU 的 0.5秒/张） |

> [!TIP]
> 首次运行时，后端会自动下载 CLIP ViT-L/14 模型（约 1.7 GB）。请确保网络连接稳定。

---

## 🚀 快速开始

### 1. 克隆与安装

```bash
git clone https://github.com/Shadyupup/PhotoRankAI.git
cd PhotoRankAI
npm install
```

### 2. 启动 Python 后端

```bash
cd backend

# (推荐) 创建虚拟环境
python -m venv venv
source venv/bin/activate   # macOS / Linux
# venv\Scripts\activate    # Windows

pip install -r requirements.txt
python server.py
```

后端服务将在 `http://localhost:8100` 启动。首次启动将自动下载 AI 模型。

> [!NOTE]
> NIMA 模型 (约 50 MB) 会瞬间下载完成。CLIP 模型 (约 1.7 GB) 首次加载时大概需要几分钟。

### 3. (可选) 配置 API 密钥

对于 **极速 (Fast)** 和 **专业 (Pro)** 增强模式，你需要提供一个 API 密钥 (Gemini 或 DashScope)。

**方式 A — 界面配置 (推荐):**
在应用的右上角点击 ⚙️ 设置图标，选择服务商，并粘贴密钥。

**方式 B — 环境变量 (`.env`):**
```bash
cp .env.example .env
# 编辑 .env 添加你的密钥:
# VITE_GEMINI_API_KEY=your_key_here
# VITE_DASHSCOPE_API_KEY=your_dashscope_key_here
```

获取免费 API Key：[aistudio.google.com/apikey (Gemini)](https://aistudio.google.com/apikey) 或 [阿里云百炼控制台 (千问)](https://dashscope.console.aliyun.com/)。

> [!NOTE]
> 核心选片打分功能 **完全不需要** 任何 API 密钥。只有画质增强功能需要。

### 4. 运行前端应用

```bash
# 网页版 (Web 开发模式)
npm run dev

# 桌面版客户端 (Electron)
npm run electron:dev
```

在浏览器中打开 [http://localhost:5173](http://localhost:5173)。

---

## 📖 使用指南

### 步骤 1 — 导入照片
1. 点击 **"Import Folder"** 或直接将文件夹拖拽至应用窗口。
2. 软件会自动加载并解析所有受支持图片的缩略图 (包括各大厂商的 RAW 格式)。

### 步骤 2 — AI 选片打分
1. 点击 **"Score All"** 批量处理所有导入的照片。
2. 后端模型将使用 NIMA (评估技术质量) 和 CLIP (评估美学质量) 对照片进行交叉排序验证。
3. 每一张照片都会获得一个 **0–100** 的得分与对应的分析短评。
4. 照片将自动根据分数重新排列，最具震撼力的绝佳镜头将浮现在最前面。

### 步骤 3 — 筛选与复查
- 拖动 **分数滑块 (Score Slider)** 来快速截断过滤 (例如: 仅显示 70 分以上的照片)。
- 开启 **连拍折叠 (Group Similar)** 以聚类视觉相同的高速连拍废片。
- 点击任意照片即可查看大图与详细的分数分解图表 (NIMA vs. CLIP)。

### 步骤 4 — AI 强化 (可选)
- 选中您最满意的照片，点击增强：
  - **Fast Mode (极速模式)** — 通过 Gemini/千问 一步生成 HDR 级的高端大片。
  - **Pro Mode (专业模式)** — AI 自审查与抗性迭代生成。

### 步骤 5 — 导出
- 将您打算保留的高分/星标照片选中。
- 点击 **"Export"**，系统会将原始/增强的高清原图无损转存到您指定的盘符路径。

---

## 🏗️ 技术栈

| 架构层 | 技术方案 |
|-------|-----------|
| **前端 UI** | React 19 + TypeScript + Vite |
| **设计语言** | Tailwind CSS + Framer Motion 动效 |
| **本地存储** | Dexie.js (IndexedDB 数据库) |
| **AI 评分端** | NIMA (MobileNetV2) + CLIP (ViT-L/14) 结合 FastAPI |
| **AI 增强端** | Google Gemini API / 阿里 DashScope (千问) API |
| **桌面运行时** | Electron 跨平台容器 |

---

## ❓ 常见问题 & 故障排除

| 报错 / 问题 | 解决方案 |
|---------|----------|
| `ModuleNotFoundError: No module named 'torch'` | 请确保已处于你的 Python 虚拟环境中，并运行 `pip install -r backend/requirements.txt` |
| 跑起来了但是打分很慢 | 检测 GPU：Mac 可执行 `python -c "import torch; print(torch.backends.mps.is_available())"`。N卡用户建议安装带 CUDA 的 PyTorch |
| CLIP 模型无法下载 | 请确保全程网络通畅；模型一般缓存于 `~/.cache/huggingface/` 目录下 |
| 端口 8100 提示占用 | 杀掉对应的幽灵进程：`lsof -ti:8100 \| xargs kill -9` |
| 读取不到 RAW 原始格式 | 确保成功安装了底层 C++ 绑定库 `rawpy`: `pip install rawpy` |
| `npm run dev` 报错抛出异常 | 照片墙和 Electron 需要使用最低支持 Node.js 18+ 的运行环境。 |

---

## 🤝 参与贡献

欢迎大家提交 PR！

1. Fork 本仓库
2. 创建您的 Feature 分支 (`git checkout -b feature/amazing-feature`)
3. 提交您的修改 (`git commit -m 'Add amazing feature'`)
4. 推送分支 (`git push origin feature/amazing-feature`)
5. 新建 Pull Request 申请合并

---

## 📄 许可协议

[MIT](LICENSE) © 2026 PhotoRank AI
