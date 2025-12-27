import { ReactNode } from 'react';

export function AppShell({ children }: { children: ReactNode }) {
    return (
        <div className="flex flex-col h-screen w-full bg-[#0B0B0C] text-gray-100 overflow-hidden font-sans tracking-tight">
            {/* Header - Glassmorphism */}
            <header className="fixed top-0 left-0 right-0 h-16 border-b border-white/[0.08] flex items-center px-6 justify-between shrink-0 bg-[#0B0B0C]/80 backdrop-blur-xl z-50 transition-all duration-300">
                <div className="flex items-center gap-3">
                    <div className="w-8 h-8 bg-gradient-to-tr from-blue-500 to-purple-500 rounded-lg flex items-center justify-center shadow-lg shadow-blue-500/20">
                        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                        </svg>
                    </div>
                    <span className="text-lg font-medium text-white/90 tracking-tight">
                        PhotoRank <span className="text-gray-500 font-normal">AI</span>
                    </span>
                </div>
            </header>

            {/* Main Content - Pad top for fixed header */}
            <main className="flex-1 flex flex-col pt-16 h-full relative overflow-hidden">
                {children}
            </main>
        </div>
    );
}
