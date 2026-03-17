import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { describe, expect, it, beforeEach } from 'vitest';

import { validateRootPath, isPathWithinRoot, isPathAllowed, validateFileSize } from './path-security.ts';

describe('path-security', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'popeye-pathsec-'));
  });

  describe('validateRootPath', () => {
    it('accepts valid directory', () => {
      const result = validateRootPath(tempDir);
      expect(result.valid).toBe(true);
    });

    it('rejects relative path', () => {
      const result = validateRootPath('relative/path');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('absolute');
    });

    it('rejects non-existent path', () => {
      const result = validateRootPath(join(tempDir, 'nonexistent'));
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('does not exist');
    });

    it('rejects file instead of directory', () => {
      const filePath = join(tempDir, 'file.txt');
      writeFileSync(filePath, 'content');
      const result = validateRootPath(filePath);
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('directory');
    });

    it('rejects forbidden system roots', () => {
      const result = validateRootPath('/');
      expect(result.valid).toBe(false);
      expect(result.reason).toContain('forbidden');
    });

    it('rejects /etc', () => {
      const result = validateRootPath('/etc');
      expect(result.valid).toBe(false);
      // On macOS, /etc is a symlink to /private/etc which resolves to a forbidden root
      expect(result.reason).toMatch(/forbidden|directory/);
    });
  });

  describe('isPathWithinRoot', () => {
    it('accepts path within root', () => {
      const subDir = join(tempDir, 'sub');
      mkdirSync(subDir);
      expect(isPathWithinRoot(tempDir, subDir)).toBe(true);
    });

    it('rejects path outside root via ..', () => {
      const outsidePath = resolve(tempDir, '..', '..', 'etc', 'passwd');
      expect(isPathWithinRoot(tempDir, outsidePath)).toBe(false);
    });

    it('rejects traversal attack', () => {
      expect(isPathWithinRoot(tempDir, '/etc/passwd')).toBe(false);
    });

    it('accepts root path itself', () => {
      expect(isPathWithinRoot(tempDir, tempDir)).toBe(true);
    });

    it('detects symlink escape', () => {
      const subDir = join(tempDir, 'sub');
      mkdirSync(subDir);
      const link = join(subDir, 'escape');
      try {
        symlinkSync('/tmp', link);
      } catch {
        // Symlinks may not be creatable in all environments
        return;
      }
      // The symlink itself resolves outside the root
      const resolved = resolve(link, 'some-file');
      expect(isPathWithinRoot(tempDir, resolved)).toBe(false);
    });
  });

  describe('isPathAllowed', () => {
    it('matches include patterns', () => {
      expect(isPathAllowed('/root', 'docs/readme.md', ['**/*.md'], [])).toBe(true);
    });

    it('rejects non-matching include patterns', () => {
      expect(isPathAllowed('/root', 'image.png', ['**/*.md', '**/*.txt'], [])).toBe(false);
    });

    it('applies exclude patterns', () => {
      expect(isPathAllowed('/root', 'node_modules/pkg/readme.md', ['**/*.md'], ['node_modules/**'])).toBe(false);
    });

    it('allows all when no include patterns', () => {
      expect(isPathAllowed('/root', 'anything.xyz', [], [])).toBe(true);
    });
  });

  describe('validateFileSize', () => {
    it('accepts files within size limit', () => {
      const filePath = join(tempDir, 'small.txt');
      writeFileSync(filePath, 'hello');
      const result = validateFileSize(filePath, 1_000_000);
      expect(result.valid).toBe(true);
      expect(result.sizeBytes).toBe(5);
    });

    it('rejects files over size limit', () => {
      const filePath = join(tempDir, 'big.txt');
      writeFileSync(filePath, 'x'.repeat(100));
      const result = validateFileSize(filePath, 10);
      expect(result.valid).toBe(false);
      expect(result.sizeBytes).toBe(100);
    });

    it('rejects non-existent files', () => {
      const result = validateFileSize(join(tempDir, 'missing.txt'), 1000);
      expect(result.valid).toBe(false);
    });
  });
});
