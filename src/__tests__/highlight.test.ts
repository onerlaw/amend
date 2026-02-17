import { describe, it, expect } from 'vitest';
import { getLanguageFromPath } from '@/lib/highlight';

describe('getLanguageFromPath', () => {
  it('maps JavaScript extensions', () => {
    expect(getLanguageFromPath('file.js')).toBe('javascript');
    expect(getLanguageFromPath('file.jsx')).toBe('javascript');
    expect(getLanguageFromPath('file.mjs')).toBe('javascript');
    expect(getLanguageFromPath('file.cjs')).toBe('javascript');
  });

  it('maps TypeScript extensions', () => {
    expect(getLanguageFromPath('file.ts')).toBe('typescript');
    expect(getLanguageFromPath('file.tsx')).toBe('typescript');
  });

  it('maps systems language extensions', () => {
    expect(getLanguageFromPath('lib.rs')).toBe('rust');
    expect(getLanguageFromPath('main.go')).toBe('go');
    expect(getLanguageFromPath('main.c')).toBe('c');
    expect(getLanguageFromPath('main.h')).toBe('c');
    expect(getLanguageFromPath('main.cpp')).toBe('cpp');
  });

  it('maps scripting language extensions', () => {
    expect(getLanguageFromPath('script.py')).toBe('python');
    expect(getLanguageFromPath('script.sh')).toBe('bash');
    expect(getLanguageFromPath('script.bash')).toBe('bash');
    expect(getLanguageFromPath('script.zsh')).toBe('bash');
  });

  it('maps data format extensions', () => {
    expect(getLanguageFromPath('config.json')).toBe('json');
    expect(getLanguageFromPath('config.yaml')).toBe('yaml');
    expect(getLanguageFromPath('config.yml')).toBe('yaml');
    expect(getLanguageFromPath('data.xml')).toBe('xml');
  });

  it('maps web extensions', () => {
    expect(getLanguageFromPath('index.html')).toBe('html');
    expect(getLanguageFromPath('styles.css')).toBe('css');
    expect(getLanguageFromPath('styles.scss')).toBe('css');
  });

  it('maps JVM language extensions', () => {
    expect(getLanguageFromPath('Main.java')).toBe('java');
    expect(getLanguageFromPath('Main.scala')).toBe('scala');
  });

  it('maps documentation extensions', () => {
    expect(getLanguageFromPath('README.md')).toBe('markdown');
    expect(getLanguageFromPath('docs.markdown')).toBe('markdown');
  });

  it('returns undefined for unknown extensions', () => {
    expect(getLanguageFromPath('file.xyz')).toBeUndefined();
  });

  it('maps known filenames without extensions', () => {
    expect(getLanguageFromPath('Makefile')).toBe('bash');
  });

  it('handles paths with directories', () => {
    expect(getLanguageFromPath('src/lib/utils.ts')).toBe('typescript');
    expect(getLanguageFromPath('/home/user/project/main.rs')).toBe('rust');
  });

  it('returns language for known extensionless filenames', () => {
    expect(getLanguageFromPath('Dockerfile')).toBe('dockerfile');
  });

  it('returns undefined for unknown extensionless files', () => {
    expect(getLanguageFromPath('LICENSE')).toBeUndefined();
  });
});
