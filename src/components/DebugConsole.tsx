import { useState, useEffect } from 'react';
import { X, Terminal } from 'lucide-react';

export function DebugConsole() {
    const [logs, setLogs] = useState<{ time: string, level: string, msg: string }[]>([]);
    const [isOpen, setIsOpen] = useState(false);

    useEffect(() => {
        const handleLog = (e: CustomEvent<{ time: string, level: string, msg: string }>) => {
            setLogs(prev => [...prev.slice(-49), e.detail]);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        window.addEventListener('app-log', handleLog as any);
        return () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            window.removeEventListener('app-log', handleLog as any);
        };
    }, []);

    if (!isOpen) {
        return (
            <button
                onClick={() => setIsOpen(true)}
                className="fixed bottom-4 right-4 bg-black/80 text-green-400 p-2 rounded-lg border border-green-500/30 z-50 hover:bg-black font-mono text-xs flex items-center gap-2"
            >
                <Terminal size={14} />
                Debug Logs
            </button>
        );
    }

    return (
        <div className="fixed bottom-4 right-4 w-[600px] h-[300px] bg-[#0A0A0A] border border-gray-800 rounded-lg shadow-2xl z-50 flex flex-col font-mono text-xs">
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800 bg-[#111]">
                <span className="text-gray-400 font-semibold flex items-center gap-2">
                    <Terminal size={14} />
                    System Logs
                </span>
                <div className="flex gap-2">
                    <button onClick={() => setLogs([])} className="text-gray-500 hover:text-white">Clear</button>
                    <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-white"><X size={14} /></button>
                </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
                {logs.length === 0 && <span className="text-gray-600 italic">No logs yet...</span>}
                {logs.map((log, i) => (
                    <div key={i} className="flex gap-2 border-b border-white/5 pb-0.5 mb-0.5">
                        <span className="text-gray-600 shrink-0">[{log.time}]</span>
                        <span className={
                            log.level === 'error' ? 'text-red-400 font-bold' :
                                log.level === 'warn' ? 'text-yellow-400' :
                                    log.level === 'success' ? 'text-green-400' : 'text-blue-300'
                        }>
                            {log.level.toUpperCase()}
                        </span>
                        <span className="text-gray-300 break-all">{log.msg}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
