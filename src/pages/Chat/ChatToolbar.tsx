/**
 * Chat Toolbar
 * Session selector, new session, refresh, and thinking toggle.
 * Rendered in the Header when on the Chat page.
 */
import { RefreshCw, Brain, ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useChatStore } from '@/stores/chat';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import { useState, useRef, useEffect } from 'react';

export function ChatToolbar() {
  const sessions = useChatStore((s) => s.sessions);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const deleteAllSessions = useChatStore((s) => s.deleteAllSessions);
  const refresh = useChatStore((s) => s.refresh);
  const loading = useChatStore((s) => s.loading);
  const showThinking = useChatStore((s) => s.showThinking);
  const toggleThinking = useChatStore((s) => s.toggleThinking);
  const { t } = useTranslation('chat');

  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const handleDeleteSession = async (key: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(t('toolbar.confirmDelete'))) {
      await deleteSession(key);
      setIsOpen(false);
    }
  };

  const handleDeleteAllSessions = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (window.confirm(t('toolbar.confirmDeleteAll'))) {
      await deleteAllSessions();
      setIsOpen(false);
    }
  };

  const handleSelectSession = (key: string) => {
    switchSession(key);
    setIsOpen(false);
  };

  // Get all sessions including current if not in list
  const allSessions = !sessions.some((s) => s.key === currentSessionKey)
    ? [{ key: currentSessionKey, displayName: currentSessionKey }, ...sessions]
    : sessions;

  const currentSession = allSessions.find((s) => s.key === currentSessionKey);
  // Prefer showing the key over displayName to show full session ID
  const displayName = currentSession?.key || currentSession?.displayName || currentSessionKey;

  return (
    <div className="flex items-center gap-2">
      {/* Session Selector */}
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className={cn(
            'appearance-none rounded-md border border-border bg-background px-3 py-1.5 pr-8',
            'text-sm text-foreground cursor-pointer',
            'focus:outline-none focus:ring-2 focus:ring-ring',
            'hover:bg-accent/50 transition-colors',
          )}
        >
          <span className="max-w-[200px] truncate inline-block">{displayName}</span>
        </button>
        <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />

        {/* Dropdown Menu */}
        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-[300px] max-h-[400px] overflow-y-auto rounded-md border border-border bg-background shadow-lg z-50">
            {/* Delete All Button */}
            {allSessions.length > 0 && (
              <div className="border-b border-border p-2">
                <button
                  onClick={handleDeleteAllSessions}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-destructive/10 rounded-md transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  <span>{t('toolbar.deleteAllSessions')}</span>
                </button>
              </div>
            )}

            {/* Session List */}
            <div className="py-1">
              {allSessions.map((session) => (
                <div
                  key={session.key}
                  className={cn(
                    'flex items-center justify-between px-3 py-2 text-sm cursor-pointer hover:bg-accent/50 transition-colors',
                    session.key === currentSessionKey && 'bg-accent',
                  )}
                  onClick={() => handleSelectSession(session.key)}
                >
                  <span className="flex-1 truncate">{session.key || session.displayName}</span>
                  <button
                    onClick={(e) => handleDeleteSession(session.key, e)}
                    className="ml-2 p-1 hover:bg-destructive/20 rounded transition-colors"
                    title={t('toolbar.deleteSession')}
                  >
                    <X className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* New Session */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={newSession}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.newSession')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Refresh */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => refresh()}
            disabled={loading}
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{t('toolbar.refresh')}</p>
        </TooltipContent>
      </Tooltip>

      {/* Thinking Toggle */}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn(
              'h-8 w-8',
              showThinking && 'bg-primary/10 text-primary',
            )}
            onClick={toggleThinking}
          >
            <Brain className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          <p>{showThinking ? t('toolbar.hideThinking') : t('toolbar.showThinking')}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
}
