
import React, { useState } from 'react';
import { motion } from 'motion/react';
import { FolderUp, Folder, Files } from 'lucide-react';

interface Props {
  onLoadFiles: (files: FileList) => void;
}

export function DropZone({ onLoadFiles }: Props) {
  const [isDragging, setIsDragging] = useState(false);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (!e.dataTransfer.items) {
      if (e.dataTransfer.files) onLoadFiles(e.dataTransfer.files);
      return;
    }

    const items = e.dataTransfer.items;
    const fileEntries: { file: File, path: string }[] = [];
    const promises: Promise<void>[] = [];

    const readEntry = (entry: any, path: string = '') => {
      return new Promise<void>((resolve) => {
        if (entry.isFile) {
          entry.file((file: File) => {
            fileEntries.push({ file, path: path + file.name });
            resolve();
          });
        } else if (entry.isDirectory) {
          const dirReader = entry.createReader();
          dirReader.readEntries((entries: any[]) => {
            const entryPromises = entries.map(e => readEntry(e, path + entry.name + '/'));
            Promise.all(entryPromises).then(() => resolve());
          });
        } else {
          resolve();
        }
      });
    };

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === 'file') {
        const entry = item.webkitGetAsEntry();
        if (entry) promises.push(readEntry(entry));
      }
    }

    await Promise.all(promises);
    if (fileEntries.length > 0) {
      onLoadFiles(fileEntries as any);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`flex items-center flex-col justify-center border-2 border-dashed cursor-pointer group overflow-hidden p-8 relative rounded-2xl text-center transition-all shadow-xl shadow-black/10 ${
        isDragging 
          ? 'border-[#4da6ff] bg-slate-800/40 shadow-[#4da6ff]/10 scale-[1.01]' 
          : 'border-white/5 bg-slate-900/10 hover:bg-white/5'
      }`}
    >
      <div className={`nop-panel-inset mb-4 p-4 transition-all ${isDragging ? 'text-[#4da6ff]' : 'text-slate-400 group-hover:text-[#4da6ff]'}`}>
        <FolderUp className="h-10 w-10 animate-bounce" style={{ animationDuration: isDragging ? '1s' : '2s' }} />
      </div>
      <h3 className="font-bold text-sm text-slate-200">フォルダをドラッグ＆ドロップ</h3>
      <p className="text-xs text-slate-400 max-w-xs mb-4">HTML、CSS、JS、画像を含むプロジェクト構造をフラットにロード</p>
      <div className="flex gap-3">
        <label className="nop-btn text-xs px-4 py-2 gap-1.5 cursor-pointer">
          <Folder className="h-3.5 w-3.5" />フォルダを選択
          {/* @ts-ignore */}
          <input 
            type="file" 
            hidden 
            webkitdirectory="true" 
            directory="true" 
            onChange={e => {
              // FileListを安全な配列にコピーしてから渡す
              const files = Array.from(e.target.files || []);
              onLoadFiles(files as any);
              (e.target as HTMLInputElement).value = '';
            }} 
          />
        </label>
        <label className="nop-btn text-xs px-4 py-2 gap-1.5 cursor-pointer">
          <Files className="h-3.5 w-3.5" />複数ファイル
          <input 
            type="file" 
            hidden 
            multiple 
            onChange={e => {
              // こちらも同様に配列にコピー
              const files = Array.from(e.target.files || []);
              onLoadFiles(files as any);
              (e.target as HTMLInputElement).value = '';
            }} 
          />
        </label>
      </div>
    </motion.div>
  );
}
