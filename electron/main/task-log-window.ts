/**
 * Task Log Window Manager
 * Manages a separate window for displaying cron task AI response logs
 * Supports real-time status updates and streaming output
 */
import { BrowserWindow, screen, nativeImage, app } from 'electron';
import { join } from 'path';
import { logger } from '../utils/logger';

// Singleton window instance
let taskLogWindow: BrowserWindow | null = null;

// Message queue for when window is loading
let pendingMessages: TaskLogEvent[] = [];
let windowReady = false;

// Cache for job info (jobId -> { name, useWindowNotification })
interface JobInfo {
  name: string;
  useWindowNotification: boolean;  // true = window notification, false = channel notification
}
const jobInfoCache = new Map<string, JobInfo>();

/**
 * Task log event types
 */
export type TaskLogEventType = 
  | 'job-started'    // Job triggered
  | 'job-running'    // AI is generating
  | 'job-delta'      // Streaming content update
  | 'job-complete'   // Final result
  | 'job-error';     // Error occurred

/**
 * Task log event structure
 */
export interface TaskLogEvent {
  type: TaskLogEventType;
  jobId: string;
  jobName?: string;
  runId?: string;
  sessionKey?: string;
  timestamp: number;
  content?: string;      // For delta/complete
  state?: string;        // For status updates
  error?: string;        // For errors
}

/**
 * Get the icons directory path
 */
function getIconsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'resources', 'icons');
  }
  return join(__dirname, '../../resources/icons');
}

/**
 * Get the app icon for the current platform
 */
function getAppIcon(): Electron.NativeImage | undefined {
  if (process.platform === 'darwin') return undefined;

  const iconsDir = getIconsDir();
  const iconPath =
    process.platform === 'win32'
      ? join(iconsDir, 'icon.ico')
      : join(iconsDir, 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  return icon.isEmpty() ? undefined : icon;
}

/**
 * Create or show the task log window
 */
export function showTaskLogWindow(): BrowserWindow {
  // If window exists and is not destroyed, just show it
  if (taskLogWindow && !taskLogWindow.isDestroyed()) {
    if (!taskLogWindow.isVisible()) {
      taskLogWindow.show();
    }
    taskLogWindow.focus();
    return taskLogWindow;
  }

  // Get screen dimensions
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  // Calculate window dimensions (70% screen height, reasonable width)
  const windowHeight = Math.round(screenHeight * 0.7);
  const windowWidth = Math.min(500, Math.round(screenWidth * 0.3));

  // Position at bottom-right corner
  const x = screenWidth - windowWidth - 20;
  const y = screenHeight - windowHeight - 20;

  // Create the window
  taskLogWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    icon: getAppIcon(),
    title: 'Dana Claw - Task Log',
    frame: true,
    resizable: true,
    minimizable: true,
    maximizable: false,
    alwaysOnTop: false,
    skipTaskbar: false,
    autoHideMenuBar: true,  // Hide default menu bar
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  // Reset state
  windowReady = false;

  // Load the task log page
  if (process.env.VITE_DEV_SERVER_URL) {
    taskLogWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}#/task-log`);
  } else {
    taskLogWindow.loadFile(join(__dirname, '../../dist/index.html'), {
      hash: '/task-log',
    });
  }

  // Handle window ready
  taskLogWindow.webContents.on('did-finish-load', () => {
    windowReady = true;
    logger.info('Task log window loaded');
    
    // Send any pending messages
    if (pendingMessages.length > 0) {
      for (const msg of pendingMessages) {
        taskLogWindow?.webContents.send('task-log:event', msg);
      }
      pendingMessages = [];
    }
  });

  // Handle window close
  taskLogWindow.on('closed', () => {
    logger.info('Task log window closed');
    taskLogWindow = null;
    windowReady = false;
    pendingMessages = [];
  });

  return taskLogWindow;
}

/**
 * Send a task log event to the window
 * Creates the window if it doesn't exist
 */
export function sendTaskLogEvent(event: TaskLogEvent): void {
  // Ensure window exists
  showTaskLogWindow();

  if (windowReady && taskLogWindow && !taskLogWindow.isDestroyed()) {
    taskLogWindow.webContents.send('task-log:event', event);
  } else {
    // Queue message for when window is ready
    pendingMessages.push(event);
  }
}

/**
 * Set job info in cache (called when job is created or listed)
 * @param jobId - The job ID
 * @param name - The job name
 * @param useWindowNotification - true if using window notification (no channel), false if using channel
 */
export function setJobInfo(jobId: string, name: string, useWindowNotification: boolean): void {
  jobInfoCache.set(jobId, { name, useWindowNotification });
}

/**
 * Get job name from cache
 */
export function getJobName(jobId: string): string | undefined {
  return jobInfoCache.get(jobId)?.name;
}

/**
 * Check if job uses window notification (not channel)
 */
export function isWindowNotificationJob(jobId: string): boolean {
  const info = jobInfoCache.get(jobId);
  // Default to true (show in window) if job info not found
  return info?.useWindowNotification ?? true;
}

/**
 * Parse cron notification and create task log event
 * Only returns event if the job is configured for window notification (not channel)
 */
export function parseCronNotification(params: Record<string, unknown>): TaskLogEvent | null {
  const jobId = params.jobId as string;
  const action = params.action as string;
  
  if (!jobId) return null;

  // Only show in task log window if job is configured for window notification
  if (!isWindowNotificationJob(jobId)) {
    return null;
  }

  const jobName = getJobName(jobId);

  if (action === 'started') {
    return {
      type: 'job-started',
      jobId,
      jobName,
      timestamp: Date.now(),
      state: 'triggered',
    };
  }

  return null;
}

/**
 * Parse agent notification and create task log event
 * Only returns event if the job is configured for window notification (not channel)
 */
export function parseAgentNotification(params: Record<string, unknown>): TaskLogEvent | null {
  const sessionKey = params.sessionKey as string;
  const runId = params.runId as string;
  const stream = params.stream as string;
  const data = params.data as Record<string, unknown> | undefined;
  
  // Only process cron task notifications
  if (!sessionKey || !sessionKey.includes(':cron:')) return null;

  // Extract jobId from sessionKey (e.g., "agent:main:cron:xxx")
  const cronMatch = sessionKey.match(/:cron:([^:]+)/);
  const jobId = cronMatch ? cronMatch[1] : 'unknown';
  
  // Only show in task log window if job is configured for window notification
  if (!isWindowNotificationJob(jobId)) {
    return null;
  }
  
  const jobName = getJobName(jobId);

  if (stream === 'lifecycle' && data?.phase === 'start') {
    return {
      type: 'job-running',
      jobId,
      jobName,
      runId,
      sessionKey,
      timestamp: Date.now(),
      state: 'generating',
    };
  }

  return null;
}

/**
 * Parse chat:message event and create task log event
 * Only returns event if the job is configured for window notification (not channel)
 */
export function parseChatMessage(data: unknown): TaskLogEvent | null {
  try {
    const msg = data as { message?: Record<string, unknown> };
    if (!msg.message) return null;

    const message = msg.message;
    const state = message.state as string;
    const sessionKey = message.sessionKey as string;
    const runId = message.runId as string;
    
    // Only process cron task messages
    if (!sessionKey || !sessionKey.includes(':cron:')) return null;

    // Extract jobId from sessionKey
    const cronMatch = sessionKey.match(/:cron:([^:]+)/);
    const jobId = cronMatch ? cronMatch[1] : 'unknown';
    
    // Only show in task log window if job is configured for window notification
    // If job uses channel notification, skip (Gateway will send via channel)
    if (!isWindowNotificationJob(jobId)) {
      return null;
    }
    
    const jobName = getJobName(jobId);

    // Extract content from message
    const innerMessage = message.message as Record<string, unknown> | undefined;
    if (!innerMessage) return null;

    const contentArray = innerMessage.content as Array<{ type: string; text?: string }> | undefined;
    
    let content = '';
    if (Array.isArray(contentArray)) {
      content = contentArray
        .filter(item => item.type === 'text' && item.text)
        .map(item => item.text)
        .join('\n');
    }

    if (!content) return null;

    if (state === 'delta') {
      return {
        type: 'job-delta',
        jobId,
        jobName,
        runId,
        sessionKey,
        timestamp: Date.now(),
        content,
        state: 'streaming',
      };
    }

    if (state === 'final') {
      return {
        type: 'job-complete',
        jobId,
        jobName,
        runId,
        sessionKey,
        timestamp: Date.now(),
        content,
        state: 'complete',
      };
    }

    return null;
  } catch (error) {
    logger.error('Failed to parse chat message for task log:', error);
    return null;
  }
}

/**
 * Close the task log window if it exists
 */
export function closeTaskLogWindow(): void {
  if (taskLogWindow && !taskLogWindow.isDestroyed()) {
    taskLogWindow.close();
  }
}

/**
 * Check if task log window exists and is visible
 */
export function isTaskLogWindowVisible(): boolean {
  return taskLogWindow !== null && !taskLogWindow.isDestroyed() && taskLogWindow.isVisible();
}
