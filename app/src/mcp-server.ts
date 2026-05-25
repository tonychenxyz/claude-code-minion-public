#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';

// Get configuration from environment
const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:3000';
const CHANNEL_ID = process.env.CHANNEL_ID || '';

if (!CHANNEL_ID) {
  console.error('CHANNEL_ID environment variable is required');
  process.exit(1);
}

async function sendToOrchestrator(data: any): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(ORCHESTRATOR_URL);
    const postData = JSON.stringify({ ...data, channelId: CHANNEL_ID });

    const options: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 3000,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve(body);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

// Create MCP server
const server = new McpServer({
  name: 'slack-messenger',
  version: '1.0.0',
});

// Tool: Send regular message (no mention)
server.tool(
  'send_regular_message',
  'Send a message to the user in Slack WITHOUT mentioning them. Use this frequently to log your thoughts, actions, and progress. IMPORTANT: Use Slack formatting (not Markdown): *bold*, _italic_, ~strike~, `code`, ```code block```',
  {
    message: z.string().describe('The message to send (use Slack formatting: *bold*, _italic_, `code`)'),
    thread_ts: z.string().optional().describe('Optional thread timestamp to reply in a specific thread. Pass the thread_ts from an incoming thread message to reply in that thread.'),
  },
  async ({ message, thread_ts }) => {
    try {
      await sendToOrchestrator({
        type: 'markdown',
        content: message,
        ...(thread_ts ? { thread_ts } : {}),
      });
      return {
        content: [{ type: 'text', text: 'Message sent' }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// Tool: Send mention message (mentions the user)
server.tool(
  'send_mention_message',
  'Send a message that @mentions the user. Use this when: (1) you have FINISHED the request, or (2) you need user input to proceed. IMPORTANT: Use Slack formatting (not Markdown): *bold*, _italic_, ~strike~, `code`, ```code block```',
  {
    message: z.string().describe('The message to send with @mention (use Slack formatting: *bold*, _italic_, `code`)'),
    thread_ts: z.string().optional().describe('Optional thread timestamp to reply in a specific thread. Pass the thread_ts from an incoming thread message to reply in that thread.'),
  },
  async ({ message, thread_ts }) => {
    try {
      await sendToOrchestrator({
        type: 'mention',
        mentionUser: true,
        mentionText: message,
        ...(thread_ts ? { thread_ts } : {}),
      });
      return {
        content: [{ type: 'text', text: 'Mention sent' }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// Tool: Upload file from disk to Slack (supports binary files like images)
server.tool(
  'upload_file',
  'Upload a file from disk to Slack. Use for images, PDFs, or any file.',
  {
    file_path: z.string().describe('The absolute path to the file to upload'),
    thread_ts: z.string().optional().describe('Optional thread timestamp to upload file in a specific thread.'),
  },
  async ({ file_path, thread_ts }) => {
    try {
      if (!fs.existsSync(file_path)) {
        return {
          content: [{ type: 'text', text: `File not found: ${file_path}` }],
          isError: true,
        };
      }

      const fileBuffer = fs.readFileSync(file_path);
      const base64Content = fileBuffer.toString('base64');
      const filename = path.basename(file_path);

      await sendToOrchestrator({
        type: 'file_upload',
        filename,
        title: filename,
        base64Content,
        ...(thread_ts ? { thread_ts } : {}),
      });
      return {
        content: [{ type: 'text', text: `File "${filename}" uploaded` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// Tool: Create a standalone Slack canvas
server.tool(
  'create_canvas',
  'Create a new standalone Slack canvas with a title and markdown content. Returns the canvas_id for future edits. Content uses markdown format (headings, lists, bold, code blocks, tables, etc.).',
  {
    title: z.string().optional().describe('Title for the canvas. If omitted, canvas is created untitled.'),
    markdown: z.string().optional().describe('Initial content in markdown format. Supports: headings (# ## ###), bold, italic, lists, code blocks, tables, links, checklists (- [ ]).'),
    channel_id: z.string().optional().describe('Optional channel ID to add the canvas to as a tab.'),
  },
  async ({ title, markdown, channel_id }) => {
    try {
      const response = await sendToOrchestrator({
        type: 'canvas_create',
        title,
        markdown,
        canvas_channel_id: channel_id,
      });
      // Parse the response to get the canvas_id
      try {
        const result = JSON.parse(response);
        if (result.ok && result.canvas_id) {
          return {
            content: [{ type: 'text', text: `Canvas created! canvas_id: ${result.canvas_id}` }],
          };
        } else {
          return {
            content: [{ type: 'text', text: `Canvas creation failed: ${result.error || JSON.stringify(result)}` }],
            isError: true,
          };
        }
      } catch {
        return {
          content: [{ type: 'text', text: `Canvas created. Response: ${response}` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// Tool: Edit an existing Slack canvas
server.tool(
  'edit_canvas',
  'Edit an existing Slack canvas. Supports operations: insert_at_start, insert_at_end, insert_before, insert_after, replace, delete, rename. Content uses markdown format.',
  {
    canvas_id: z.string().describe('The ID of the canvas to edit (e.g., F0166DCSTS7).'),
    operation: z.enum(['insert_at_start', 'insert_at_end', 'insert_before', 'insert_after', 'replace', 'delete', 'rename']).describe('The edit operation to perform.'),
    markdown: z.string().optional().describe('Markdown content for the operation. Required for insert/replace operations. For rename, this is the new title.'),
    section_id: z.string().optional().describe('Target section ID. Required for insert_before, insert_after, replace, delete. Format like: temp:C:VXX8e648e6984e441c6aa8c61173'),
  },
  async ({ canvas_id, operation, markdown, section_id }) => {
    try {
      const response = await sendToOrchestrator({
        type: 'canvas_edit',
        canvas_id,
        operation,
        markdown,
        section_id,
      });
      try {
        const result = JSON.parse(response);
        if (result.ok) {
          return {
            content: [{ type: 'text', text: `Canvas edited successfully (${operation}).` }],
          };
        } else {
          return {
            content: [{ type: 'text', text: `Canvas edit failed: ${result.error || JSON.stringify(result)}` }],
            isError: true,
          };
        }
      } catch {
        return {
          content: [{ type: 'text', text: `Canvas edit done. Response: ${response}` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// Tool: Create a channel canvas (pinned to a channel)
server.tool(
  'create_channel_canvas',
  'Create a new canvas pinned to a specific Slack channel as a resource hub. Returns the canvas_id. Content uses markdown format.',
  {
    channel_id: z.string().describe('The channel ID to create the canvas in.'),
    title: z.string().optional().describe('Title for the channel canvas.'),
    markdown: z.string().optional().describe('Initial content in markdown format.'),
  },
  async ({ channel_id, title, markdown }) => {
    try {
      const response = await sendToOrchestrator({
        type: 'canvas_create_channel',
        canvas_channel_id: channel_id,
        title,
        markdown,
      });
      try {
        const result = JSON.parse(response);
        if (result.ok && result.canvas_id) {
          return {
            content: [{ type: 'text', text: `Channel canvas created! canvas_id: ${result.canvas_id}` }],
          };
        } else {
          return {
            content: [{ type: 'text', text: `Channel canvas creation failed: ${result.error || JSON.stringify(result)}` }],
            isError: true,
          };
        }
      } catch {
        return {
          content: [{ type: 'text', text: `Channel canvas created. Response: ${response}` }],
        };
      }
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Failed: ${error}` }],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Slack Messenger MCP server running for channel ${CHANNEL_ID}`);
}

main().catch((error) => {
  console.error('Failed to start MCP server:', error);
  process.exit(1);
});
