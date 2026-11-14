// Where to go to look at the problem, by what raised the alert.
export const ALERT_ROUTES: Record<string, { to: string; label: string }> = {
  issue: { to: '/issue', label: 'Open issues' }, count: { to: '/counts', label: 'Open counts' }, maint: { to: '/maintenance', label: 'Open maintenance' },
  indent: { to: '/indents', label: 'Open indents' }, sos: { to: '/sos', label: 'Open SOS' }, buying: { to: '/buying', label: 'Open buying' }, receive: { to: '/receive', label: 'Open receiving' }
};

export const routeForAlert = (a: { source?: string | null; title: string }): { to: string; label: string } | null =>
  (a.source ? ALERT_ROUTES[a.source] : undefined) ??
  (/indent/i.test(a.title) ? ALERT_ROUTES.indent
    : /sos/i.test(a.title) ? ALERT_ROUTES.sos
    : /maint|overdue|due/i.test(a.title) ? ALERT_ROUTES.maint
    : /count/i.test(a.title) ? ALERT_ROUTES.count
    : /issue|received/i.test(a.title) ? ALERT_ROUTES.issue
    : null);
