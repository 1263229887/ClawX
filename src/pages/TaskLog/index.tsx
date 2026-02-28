/**
 * Task Log Page
 * Displays AI response logs from cron tasks in a dedicated window
 * Supports real-time status updates and streaming output
 */
import { useEffect, useState, useRef, useCallback } from 'react';
import { Clock, Trash2, Copy, Check, Loader2, PlayCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

/**
 * Task log event types (matches electron/main/task-log-window.ts)
 */
type TaskLogEventType = 
  | 'job-started'
  | 'job-running'
  | 'job-delta'
  | 'job-complete'
  | 'job-error';

/**
 * Task log event structure
 */
interface TaskLogEvent {
  type: TaskLogEventType;
  jobId: string;
  jobName?: string;
  runId?: string;
  sessionKey?: string;
  timestamp: number;
  content?: string;
  state?: string;
  error?: string;
}

/**
 * Task entry in the log (aggregates events for a single run)
 */
interface TaskEntry {
  id: string;           // runId or jobId-timestamp
  jobId: string;
  jobName?: string;
  startTime: number;
  endTime?: number;
  status: 'triggered' | 'generating' | 'streaming' | 'complete' | 'error';
  content: string;
  error?: string;
}

export default function TaskLogPage() {
  const [entries, setEntries] = useState<TaskEntry[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Handle incoming events
  const handleEvent = useCallback((event: TaskLogEvent) => {
    setEntries((prev) => {
      // Find existing entry by runId or create new one
      const entryId = event.runId || `${event.jobId}-${event.timestamp}`;
      const existingIndex = prev.findIndex(e => 
        e.id === entryId || 
        (e.jobId === event.jobId && e.status !== 'complete' && e.status !== 'error')
      );

      if (existingIndex >= 0) {
        // Update existing entry
        const updated = [...prev];
        const existing = updated[existingIndex];

        switch (event.type) {
          case 'job-started':
            existing.status = 'triggered';
            existing.jobName = event.jobName || existing.jobName;
            break;
          case 'job-running':
            existing.status = 'generating';
            existing.id = event.runId || existing.id;
            existing.jobName = event.jobName || existing.jobName;
            break;
          case 'job-delta':
            existing.status = 'streaming';
            // Delta content is cumulative, always update if present
            if (event.content) {
              existing.content = event.content;
            }
            existing.jobName = event.jobName || existing.jobName;
            break;
          case 'job-complete':
            existing.status = 'complete';
            // Final content should always replace - this is the authoritative result
            if (event.content) {
              existing.content = event.content;
            }
            existing.endTime = event.timestamp;
            existing.jobName = event.jobName || existing.jobName;
            break;
          case 'job-error':
            existing.status = 'error';
            existing.error = event.error;
            existing.endTime = event.timestamp;
            break;
        }

        return updated;
      } else {
        // Create new entry
        const newEntry: TaskEntry = {
          id: entryId,
          jobId: event.jobId,
          jobName: event.jobName,
          startTime: event.timestamp,
          status: event.type === 'job-started' ? 'triggered' :
                  event.type === 'job-running' ? 'generating' :
                  event.type === 'job-delta' ? 'streaming' :
                  event.type === 'job-complete' ? 'complete' : 'error',
          content: event.content || '',
          error: event.error,
          endTime: event.type === 'job-complete' || event.type === 'job-error' ? event.timestamp : undefined,
        };

        // Keep last 30 entries
        const newEntries = [...prev, newEntry];
        if (newEntries.length > 30) {
          return newEntries.slice(-30);
        }
        return newEntries;
      }
    });
  }, []);

  useEffect(() => {
    // Listen for task log events from main process
    const handleMessage = (...args: unknown[]) => {
      const event = args[0] as TaskLogEvent;
      if (!event || typeof event !== 'object') return;
      handleEvent(event);
    };

    window.electron.ipcRenderer.on('task-log:event', handleMessage);

    return () => {
      window.electron.ipcRenderer.off('task-log:event', handleMessage);
    };
  }, [handleEvent]);

  // Auto-scroll to bottom when new content arrives
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [entries]);

  const handleCopy = async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  const handleClear = () => {
    setEntries([]);
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const getStatusBadge = (status: TaskEntry['status']) => {
    switch (status) {
      case 'triggered':
        return (
          <Badge variant="secondary" className="gap-1">
            <PlayCircle className="h-3 w-3" />
            已触发
          </Badge>
        );
      case 'generating':
        return (
          <Badge variant="secondary" className="gap-1 bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            等待响应
          </Badge>
        );
      case 'streaming':
        return (
          <Badge variant="secondary" className="gap-1 bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300">
            <Loader2 className="h-3 w-3 animate-spin" />
            生成中
          </Badge>
        );
      case 'complete':
        return (
          <Badge variant="secondary" className="gap-1 bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
            <CheckCircle2 className="h-3 w-3" />
            完成
          </Badge>
        );
      case 'error':
        return (
          <Badge variant="destructive" className="gap-1">
            错误
          </Badge>
        );
    }
  };

  return (
    <div className="h-screen flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between p-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">任务日志</h1>
          <span className="text-sm text-muted-foreground">
            ({entries.length} 条)
          </span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleClear}
          disabled={entries.length === 0}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-1" />
          清空
        </Button>
      </div>

      {/* Entries Container */}
      <div
        ref={containerRef}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
            <Clock className="h-12 w-12 mb-3 opacity-50" />
            <p className="text-sm">等待任务执行...</p>
            <p className="text-xs mt-1">定时任务的执行日志将显示在这里</p>
          </div>
        ) : (
          entries.map((entry) => (
            <Card key={entry.id} className="overflow-hidden">
              <CardHeader className="py-2 px-3 bg-muted/30">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-primary shrink-0">{formatTime(entry.startTime)}</span>
                    {entry.jobName && (
                      <span className="text-foreground truncate font-semibold">{entry.jobName}</span>
                    )}
                    {!entry.jobName && (
                      <span className="text-muted-foreground text-xs truncate">{entry.jobId.slice(0, 8)}...</span>
                    )}
                  </CardTitle>
                  <div className="flex items-center gap-2 shrink-0">
                    {getStatusBadge(entry.status)}
                    {entry.content && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleCopy(entry.content, entry.id)}
                      >
                        {copiedId === entry.id ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-3">
                {entry.status === 'triggered' && !entry.content && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>任务已触发，等待 AI 响应...</span>
                  </div>
                )}
                {entry.status === 'generating' && !entry.content && (
                  <div className="flex items-center gap-2 text-muted-foreground text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>AI 正在思考...</span>
                  </div>
                )}
                {entry.content && (
                  <div className={cn(
                    "prose prose-sm dark:prose-invert max-w-none",
                    "prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-li:my-0",
                    entry.status === 'streaming' && "animate-pulse"
                  )}>
                    <ReactMarkdown>{entry.content}</ReactMarkdown>
                  </div>
                )}
                {entry.error && (
                  <div className="text-sm text-destructive">
                    {entry.error}
                  </div>
                )}
                {entry.endTime && (
                  <div className="text-xs text-muted-foreground mt-2 pt-2 border-t">
                    耗时: {((entry.endTime - entry.startTime) / 1000).toFixed(1)}s
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
