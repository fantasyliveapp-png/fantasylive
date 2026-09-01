'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Bell,
  Check,
  Crown,
  Gift,
  MessageCircle,
  Paperclip,
  PhoneCall,
  Star,
  UserPlus,
} from 'lucide-react';
import type { NotificationType } from '@prisma/client';

import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from '@/server/actions/notifications';
import { cn, relativeTime } from '@/lib/utils';

interface NotificationRow {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  link: string | null;
  isRead: boolean;
  createdAt: string;
}

const TYPE_ICON: Record<NotificationType, typeof Bell> = {
  NEW_FOLLOWER: UserPlus,
  NEW_SUBSCRIBER: Crown,
  NEW_REVIEW: Star,
  CONTENT_REQUEST_RECEIVED: Gift,
  CONTENT_REQUEST_QUOTED: Gift,
  CONTENT_REQUEST_DELIVERED: Gift,
  NEW_MESSAGE: MessageCircle,
  MESSAGE_ATTACHMENT_UNLOCKED: Paperclip,
  INCOMING_CALL: PhoneCall,
};

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loaded, setLoaded] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setNotifications(data.notifications ?? []);
      setUnreadCount(data.unreadCount ?? 0);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    load();
    // 12 s: la campana hace de timbre de las llamadas entrantes, y con 30 s
    // quien llama se pasaba media eternidad esperando a que apareciera.
    const interval = setInterval(load, 12_000);
    return () => clearInterval(interval);
  }, []);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) load();
  }

  async function onItemClick(notification: NotificationRow) {
    if (!notification.isRead) {
      setNotifications((prev) =>
        prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
      await markNotificationReadAction(notification.id);
    }
    setOpen(false);
    if (notification.link) router.push(notification.link);
  }

  async function markAllRead() {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await markAllNotificationsReadAction();
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="relative" aria-label="Notificaciones">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
          <p className="text-sm font-semibold">Notificaciones</p>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <Check className="h-3 w-3" />
              Marcar todas leidas
            </button>
          )}
        </div>

        <div className="max-h-96 overflow-y-auto">
          {!loaded ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              Cargando...
            </p>
          ) : notifications.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted-foreground">
              No tenes notificaciones todavia.
            </p>
          ) : (
            notifications.map((n) => {
              const Icon = TYPE_ICON[n.type] ?? Bell;
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => onItemClick(n)}
                  className={cn(
                    'flex w-full items-start gap-2.5 border-b border-border/50 px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-muted/50',
                    !n.isRead && 'bg-primary/5',
                  )}
                >
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm leading-snug">{n.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {relativeTime(n.createdAt)}
                    </span>
                  </span>
                  {!n.isRead && (
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                  )}
                </button>
              );
            })
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
