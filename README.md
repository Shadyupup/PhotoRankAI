# PhotoRank AI 📸

**AI-Powered Professional Photo Culling & Aesthetic Scoring Tool**

PhotoRank AI is a high-performance web application designed for photographers to automate the tedious process of selecting the best shots from thousands of images.

### ✨ Key Features
- **Privacy-First**: All image compression and processing happen locally in your browser via Web Workers and IndexedDB.
- **AI Aesthetic Scoring**: Uses Google Gemini Pro Vision to provide multi-dimensional scoring (composition, lighting, technical quality).
- **Industrial Performance**: Handles large batches of high-res photos without freezing the UI.
- **Offline Persistent**: Your ratings and progress are saved locally in the browser.

### 🛠️ Tech Stack
- **Framework**: React 19 + Vite 7 (Latest)
- **Intelligence**: Google Gemini API
- **Storage**: Dexie.js (IndexedDB)
- **Animation**: Framer Motion
- **Styling**: Tailwind CSS

### 🚀 Getting Started
1. **Clone the repo**: `git clone https://github.com/Shadyupup/PhotoRank-AI.git`
2. **Install**: `npm install`
3. **Set up API Key**: Create a `.env` file and add `VITE_GEMINI_API_KEY=your_key_here`
4. **Run**: `npm run dev`
