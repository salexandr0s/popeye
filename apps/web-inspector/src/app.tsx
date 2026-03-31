import { Component, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ApiProvider } from './api/provider';
import { AppLayout } from './layout/app-layout';
import { Dashboard } from './views/dashboard';
import { CommandCenter } from './views/command-center';
import { RunsList } from './views/runs-list';
import { RunDetail } from './views/run-detail';
import { JobsList } from './views/jobs-list';
import { ReceiptsList } from './views/receipts-list';
import { ReceiptDetail } from './views/receipt-detail';
import { Instructions } from './views/instructions';
import { Interventions } from './views/interventions';
import { MemorySearch } from './views/memory-search';
import { Approvals } from './views/approvals';
import { StandingApprovals } from './views/standing-approvals';
import { AutomationGrants } from './views/automation-grants';
import { SecurityPolicy } from './views/security-policy';
import { Usage } from './views/usage';
import { Vaults } from './views/vaults';
import { Connections } from './views/connections';
import { Email } from './views/email';
import { Calendar } from './views/calendar';
import { Github } from './views/github';
import { People } from './views/people';
import { Todos } from './views/todos';
import { Finance } from './views/finance';
import { Medical } from './views/medical';
import { Files } from './views/files';
import { Playbooks } from './views/playbooks';
import { PlaybookDetailView } from './views/playbook-detail';
import { PlaybookProposals } from './views/playbook-proposals';
import { PlaybookProposalDetailView } from './views/playbook-proposal-detail';
import { PlaybookProposalNewView } from './views/playbook-proposal-new';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="p-[24px]">
          <h1 className="text-[18px] font-semibold text-[var(--color-danger)] mb-[8px]">
            Something went wrong
          </h1>
          <p className="text-[14px] text-[var(--color-fg-muted)] font-mono">
            {this.state.error.message}
          </p>
        </div>
      );
    }
    return this.props.children;
  }
}

export function App() {
  return (
    <ApiProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route element={<AppLayout />}>
              <Route index element={<Dashboard />} />
              <Route path="command-center" element={<CommandCenter />} />
              <Route path="runs" element={<RunsList />} />
              <Route path="runs/:id" element={<RunDetail />} />
              <Route path="jobs" element={<JobsList />} />
              <Route path="receipts" element={<ReceiptsList />} />
              <Route path="receipts/:id" element={<ReceiptDetail />} />
              <Route path="instructions" element={<Instructions />} />
              <Route path="playbooks" element={<Playbooks />} />
              <Route path="playbooks/:recordId" element={<PlaybookDetailView />} />
              <Route path="playbook-proposals" element={<PlaybookProposals />} />
              <Route path="playbook-proposals/new" element={<PlaybookProposalNewView />} />
              <Route path="playbook-proposals/:proposalId" element={<PlaybookProposalDetailView />} />
              <Route path="interventions" element={<Interventions />} />
              <Route path="approvals" element={<Approvals />} />
              <Route path="standing-approvals" element={<StandingApprovals />} />
              <Route path="automation-grants" element={<AutomationGrants />} />
              <Route path="connections" element={<Connections />} />
              <Route path="email" element={<Email />} />
              <Route path="calendar" element={<Calendar />} />
              <Route path="github" element={<Github />} />
              <Route path="people" element={<People />} />
              <Route path="todos" element={<Todos />} />
              <Route path="finance" element={<Finance />} />
              <Route path="medical" element={<Medical />} />
              <Route path="files" element={<Files />} />
              <Route path="vaults" element={<Vaults />} />
              <Route path="security-policy" element={<SecurityPolicy />} />
              <Route path="memory" element={<MemorySearch />} />
              <Route path="usage" element={<Usage />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </ApiProvider>
  );
}
