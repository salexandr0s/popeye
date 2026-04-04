import { NavLink } from 'react-router-dom';
import { StatusIndicator } from './status-indicator';

interface NavItem {
  label: string;
  to: string;
}

const navItems: NavItem[] = [
  { label: 'Dashboard', to: '/' },
  { label: 'Command Center', to: '/command-center' },
  { label: 'Runs', to: '/runs' },
  { label: 'Jobs', to: '/jobs' },
  { label: 'Receipts', to: '/receipts' },
  { label: 'Instructions', to: '/instructions' },
  { label: 'Playbooks', to: '/playbooks' },
  { label: 'Playbook Proposals', to: '/playbook-proposals' },
  { label: 'Interventions', to: '/interventions' },
  { label: 'Approvals', to: '/approvals' },
  { label: 'Standing Approvals', to: '/standing-approvals' },
  { label: 'Automation Grants', to: '/automation-grants' },
  { label: 'Connections', to: '/connections' },
  { label: 'Email', to: '/email' },
  { label: 'Calendar', to: '/calendar' },
  { label: 'GitHub', to: '/github' },
  { label: 'People', to: '/people' },
  { label: 'Todos', to: '/todos' },
  { label: 'Finance', to: '/finance' },
  { label: 'Medical', to: '/medical' },
  { label: 'Files', to: '/files' },
  { label: 'Knowledge', to: '/knowledge' },
  { label: 'Vaults', to: '/vaults' },
  { label: 'Security Policy', to: '/security-policy' },
  { label: 'Memory', to: '/memory' },
  { label: 'Usage', to: '/usage' },
];

export function Sidebar() {
  return (
    <aside className="w-[240px] min-h-screen border-r border-[var(--color-border)] bg-[var(--color-bg-muted)] flex flex-col">
      <div className="px-[20px] py-[20px] border-b border-[var(--color-border)]">
        <h2 className="text-[18px] font-semibold text-[var(--color-fg)]">
          Popeye
        </h2>
        <p className="text-[12px] text-[var(--color-fg-muted)] mt-[4px]">
          Inspector
        </p>
        <div className="mt-[12px]">
          <StatusIndicator />
        </div>
      </div>
      <nav className="flex-1 py-[8px]">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `block px-[20px] py-[8px] text-[14px] transition-colors duration-[var(--duration-fast)] ${
                isActive
                  ? 'text-[var(--color-accent)] font-medium bg-[var(--color-accent)]/5'
                  : 'text-[var(--color-fg-muted)] hover:text-[var(--color-fg)] hover:bg-[var(--color-fg)]/[0.03]'
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
