export class VirtualFileSystem {
    private files: Map<string, string> = new Map();

    constructor(initialFiles?: Map<string, string>) {
        if (initialFiles) {
            this.files = new Map(initialFiles);
        }
    }

    read(path: string): string | undefined {
        return this.files.get(path);
    }

    write(path: string, content: string): void {
        this.files.set(path, content);
    }

    delete(path: string): void {
        this.files.delete(path);
    }

    list(extension?: string): string[] {
        const allPaths = Array.from(this.files.keys());
        if (extension) {
            return allPaths.filter(p => p.endsWith(extension));
        }
        return allPaths;
    }

    getAll(): Map<string, string> {
        return new Map(this.files);
    }

    serialize(): Record<string, string> {
        const obj: Record<string, string> = {};
        this.files.forEach((content, path) => {
            obj[path] = content;
        });
        return obj;
    }

    static fromSerialized(obj: Record<string, string>): VirtualFileSystem {
        const vfs = new VirtualFileSystem();
        Object.entries(obj).forEach(([path, content]) => {
            vfs.write(path, content);
        });
        return vfs;
    }
}
