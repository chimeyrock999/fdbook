import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { ContentBlock, PromptCapabilities } from '@agentclientprotocol/sdk';

// A document attached to a message, as kept (attachments.ts).
export type AttachedFile = { absolute: string; name: string };

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  md: 'text/markdown',
  mdx: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  json: 'application/json',
  yaml: 'application/yaml',
  yml: 'application/yaml',
  html: 'text/html',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
// The images an agent that takes images is sent as one.
const IMAGES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

export const mimeOf = (name: string) => MIME_TYPES[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream';

// The bytes as text, if they are UTF-8 text.
export function textOf(bytes: Buffer) {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// The attachments as ACP content after the message's text: the documents
// live outside the worktree, where the agent's file tools do not reach, so
// each one goes in the prompt. An image as an image when the agent takes
// images; any document embedded (as text, or as base64) when it takes
// embedded resources; else only a link to the file, which every agent
// takes, and its own tools may or may not open.
export async function attachmentBlocks(files: AttachedFile[], capabilities: PromptCapabilities | null | undefined): Promise<ContentBlock[]> {
  const blocks: ContentBlock[] = [];
  for (const { absolute, name } of files) {
    const bytes = await readFile(absolute).catch(() => null);
    if (bytes === null) continue;
    const uri = pathToFileURL(absolute).href;
    const mimeType = mimeOf(name);
    if (IMAGES.has(mimeType) && capabilities?.image === true) blocks.push({ type: 'image', data: bytes.toString('base64'), mimeType, uri });
    else if (capabilities?.embeddedContext === true) {
      const text = textOf(bytes);
      blocks.push({ type: 'resource', resource: text === null ? { uri, mimeType, blob: bytes.toString('base64') } : { uri, mimeType: mimeType === 'application/octet-stream' ? 'text/plain' : mimeType, text } });
    } else blocks.push({ type: 'resource_link', uri, name, mimeType, size: bytes.length });
  }
  return blocks;
}
