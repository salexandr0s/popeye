import Foundation
import Testing

@testable import PopeyeAPI

@Suite("SystemService")
struct ServiceTests {
  @Test("DashboardSnapshot fields match DTOs")
  func snapshotFields() {
    let status = DaemonStatusDTO(
      ok: true, runningJobs: 2, queuedJobs: 1,
      openInterventions: 0, activeLeases: 2,
      engineKind: "pi", schedulerRunning: true,
      startedAt: "2026-03-22T10:00:00Z", lastShutdownAt: nil
    )
    let scheduler = SchedulerStatusDTO(
      running: true, activeLeases: 2, activeRuns: 1,
      nextHeartbeatDueAt: "2026-03-22T10:05:00Z"
    )
    let capabilities = EngineCapabilitiesDTO(
      engineKind: "pi", persistentSessionSupport: true,
      resumeBySessionRefSupport: true, hostToolMode: "native",
      compactionEventSupport: true, cancellationMode: "rpc_abort",
      acceptedRequestMetadata: [], warnings: []
    )
    let usage = UsageSummaryDTO(
      runs: 42, tokensIn: 150000, tokensOut: 80000,
      estimatedCostUsd: 3.45
    )
    let audit = SecurityAuditDTO(findings: [])

    let snapshot = DashboardSnapshot(
      status: status, scheduler: scheduler,
      capabilities: capabilities, usage: usage,
      securityAudit: audit
    )

    #expect(snapshot.status.runningJobs == 2)
    #expect(snapshot.scheduler.running == true)
    #expect(snapshot.capabilities.engineKind == "pi")
    #expect(snapshot.usage.estimatedCostUsd == 3.45)
    #expect(snapshot.securityAudit?.findings.isEmpty == true)
  }

  @Test("DashboardSnapshot with nil audit")
  func snapshotNilAudit() {
    let snapshot = DashboardSnapshot(
      status: DaemonStatusDTO(
        ok: true, runningJobs: 0, queuedJobs: 0,
        openInterventions: 0, activeLeases: 0,
        engineKind: "fake", schedulerRunning: false,
        startedAt: "2026-03-22T10:00:00Z", lastShutdownAt: nil
      ),
      scheduler: SchedulerStatusDTO(
        running: false, activeLeases: 0, activeRuns: 0,
        nextHeartbeatDueAt: nil
      ),
      capabilities: EngineCapabilitiesDTO(
        engineKind: "fake", persistentSessionSupport: false,
        resumeBySessionRefSupport: false, hostToolMode: "none",
        compactionEventSupport: false, cancellationMode: "none",
        acceptedRequestMetadata: [], warnings: []
      ),
      usage: UsageSummaryDTO(
        runs: 0, tokensIn: 0, tokensOut: 0,
        estimatedCostUsd: 0
      ),
      securityAudit: nil
    )

    #expect(snapshot.securityAudit == nil)
    #expect(snapshot.status.ok == true)
  }

  @Test("Identity endpoints encode workspace query")
  func identityEndpoints() {
    let identities = Endpoint.identities(workspaceId: "default")
    let defaultIdentity = Endpoint.defaultIdentity(workspaceId: "default")

    #expect(identities.path == "/v1/identities")
    #expect(identities.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(defaultIdentity.path == "/v1/identities/default")
    #expect(
      defaultIdentity.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
  }

  @Test("OAuth and secret endpoints use the expected paths")
  func setupActionEndpoints() {
    let oauthStart = Endpoint.startOAuthConnection
    let oauthProviders = Endpoint.oauthConnectionProviders
    let oauthSession = Endpoint.oauthConnectionSession(id: "oauth-session-001")
    let updateConnection = Endpoint.updateConnection(id: "conn-001")
    let resourceRules = Endpoint.connectionResourceRules(id: "conn-001")
    let addRule = Endpoint.addConnectionResourceRule(id: "conn-001")
    let deleteRule = Endpoint.deleteConnectionResourceRule(id: "conn-001")
    let diagnostics = Endpoint.connectionDiagnostics(id: "conn-001")
    let reconnect = Endpoint.reconnectConnection(id: "conn-001")
    let secretStore = Endpoint.storeSecret

    #expect(oauthStart.path == "/v1/connections/oauth/start")
    #expect(oauthStart.method == .post)
    #expect(oauthProviders.path == "/v1/connections/oauth/providers")
    #expect(oauthProviders.method == .get)
    #expect(oauthSession.path == "/v1/connections/oauth/sessions/oauth-session-001")
    #expect(updateConnection.path == "/v1/connections/conn-001")
    #expect(updateConnection.method == .patch)
    #expect(resourceRules.path == "/v1/connections/conn-001/resource-rules")
    #expect(resourceRules.method == .get)
    #expect(addRule.path == "/v1/connections/conn-001/resource-rules")
    #expect(addRule.method == .post)
    #expect(deleteRule.path == "/v1/connections/conn-001/resource-rules")
    #expect(deleteRule.method == .delete)
    #expect(diagnostics.path == "/v1/connections/conn-001/diagnostics")
    #expect(reconnect.path == "/v1/connections/conn-001/reconnect")
    #expect(reconnect.method == .post)
    #expect(secretStore.path == "/v1/secrets")
    #expect(secretStore.method == .post)
  }

  @Test("Workspace and Telegram control endpoints use the expected paths")
  func workspaceAndTelegramEndpoints() {
    let workspaces = Endpoint.workspaces
    let telegramConfig = Endpoint.telegramConfig
    let saveTelegramConfig = Endpoint.saveTelegramConfig
    let applyTelegramConfig = Endpoint.applyTelegramConfig
    let restartDaemon = Endpoint.restartDaemon
    let mutationReceipts = Endpoint.mutationReceipts(component: "telegram", limit: 6)

    #expect(workspaces.path == "/v1/workspaces")
    #expect(telegramConfig.path == "/v1/config/telegram")
    #expect(saveTelegramConfig.method == .post)
    #expect(applyTelegramConfig.path == "/v1/daemon/components/telegram/apply")
    #expect(restartDaemon.path == "/v1/daemon/restart")
    #expect(mutationReceipts.path == "/v1/governance/mutation-receipts")
    #expect(
      mutationReceipts.queryItems.contains(URLQueryItem(name: "component", value: "telegram")))
    #expect(mutationReceipts.queryItems.contains(URLQueryItem(name: "limit", value: "6")))
  }

  @Test("Provider auth config endpoints use the expected paths")
  func providerAuthEndpoints() {
    let providerAuthConfig = Endpoint.providerAuthConfig
    let saveGoogleProviderAuth = Endpoint.updateProviderAuthConfig(provider: "google")

    #expect(providerAuthConfig.path == "/v1/config/provider-auth")
    #expect(providerAuthConfig.method == .get)
    #expect(saveGoogleProviderAuth.path == "/v1/config/provider-auth/google")
    #expect(saveGoogleProviderAuth.method == .post)
  }

  @Test("Automation endpoints encode workspace and action paths")
  func automationEndpoints() {
    let automations = Endpoint.automations(workspaceId: "default")
    let automation = Endpoint.automation(id: "task:heartbeat:default")
    let update = Endpoint.updateAutomation(id: "task:heartbeat:default")
    let runNow = Endpoint.runAutomationNow(id: "task:heartbeat:default")
    let pause = Endpoint.pauseAutomation(id: "task:heartbeat:default")
    let resume = Endpoint.resumeAutomation(id: "task:heartbeat:default")

    #expect(automations.path == "/v1/automations")
    #expect(automations.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(automation.path == "/v1/automations/task:heartbeat:default")
    #expect(update.path == "/v1/automations/task:heartbeat:default")
    #expect(update.method == .patch)
    #expect(runNow.path == "/v1/automations/task:heartbeat:default/run-now")
    #expect(runNow.method == .post)
    #expect(pause.path == "/v1/automations/task:heartbeat:default/pause")
    #expect(pause.method == .post)
    #expect(resume.path == "/v1/automations/task:heartbeat:default/resume")
    #expect(resume.method == .post)
  }

  @Test("Home and curated document endpoints encode workspace-aware paths")
  func homeAndCuratedEndpoints() {
    let home = Endpoint.homeSummary(workspaceId: "default")
    let curated = Endpoint.curatedDocuments(workspaceId: "default")
    let curatedDocument = Endpoint.curatedDocument(id: "workspace:default:instructions")
    let propose = Endpoint.proposeCuratedDocumentSave(id: "workspace:default:instructions")
    let apply = Endpoint.applyCuratedDocumentSave(id: "workspace:default:instructions")

    #expect(home.path == "/v1/home/summary")
    #expect(home.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(curated.path == "/v1/curated-documents")
    #expect(curated.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(curatedDocument.path == "/v1/curated-documents/workspace:default:instructions")
    #expect(propose.path == "/v1/curated-documents/workspace:default:instructions/propose-save")
    #expect(propose.method == .post)
    #expect(apply.path == "/v1/curated-documents/workspace:default:instructions/apply-save")
    #expect(apply.method == .post)
  }

  @Test("Knowledge endpoints encode workspace and document paths")
  func knowledgeEndpoints() {
    let sources = Endpoint.knowledgeSources(workspaceId: "default")
    let source = Endpoint.knowledgeSource(id: "source-1")
    let snapshots = Endpoint.knowledgeSourceSnapshots(id: "source-1")
    let reingest = Endpoint.reingestKnowledgeSource(id: "source-1")
    let converters = Endpoint.knowledgeConverters
    let betaRuns = Endpoint.knowledgeBetaRuns(workspaceId: "default", limit: 1)
    let betaRun = Endpoint.knowledgeBetaRun(id: "beta-1")
    let documents = Endpoint.knowledgeDocuments(
      workspaceId: "default", kind: "wiki_article", query: "compiler")
    let document = Endpoint.knowledgeDocument(id: "doc-1")
    let revisions = Endpoint.knowledgeDocumentRevisions(id: "doc-1")
    let propose = Endpoint.proposeKnowledgeDocumentRevision(id: "doc-1")
    let apply = Endpoint.applyKnowledgeRevision(id: "rev-1")
    let reject = Endpoint.rejectKnowledgeRevision(id: "rev-1")
    let neighborhood = Endpoint.knowledgeNeighborhood(id: "doc-1")
    let compileJobs = Endpoint.knowledgeCompileJobs(workspaceId: "default")
    let audit = Endpoint.knowledgeAudit(workspaceId: "default")

    #expect(sources.path == "/v1/knowledge/sources")
    #expect(sources.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(source.path == "/v1/knowledge/sources/source-1")
    #expect(snapshots.path == "/v1/knowledge/sources/source-1/snapshots")
    #expect(reingest.path == "/v1/knowledge/sources/source-1/reingest")
    #expect(reingest.method == .post)
    #expect(converters.path == "/v1/knowledge/converters")
    #expect(betaRuns.path == "/v1/knowledge/beta-runs")
    #expect(betaRuns.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(betaRuns.queryItems.contains(URLQueryItem(name: "limit", value: "1")))
    #expect(betaRun.path == "/v1/knowledge/beta-runs/beta-1")
    #expect(documents.path == "/v1/knowledge/documents")
    #expect(documents.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(documents.queryItems.contains(URLQueryItem(name: "kind", value: "wiki_article")))
    #expect(documents.queryItems.contains(URLQueryItem(name: "q", value: "compiler")))
    #expect(document.path == "/v1/knowledge/documents/doc-1")
    #expect(revisions.path == "/v1/knowledge/documents/doc-1/revisions")
    #expect(propose.path == "/v1/knowledge/documents/doc-1/revisions")
    #expect(propose.method == .post)
    #expect(apply.path == "/v1/knowledge/revisions/rev-1/apply")
    #expect(apply.method == .post)
    #expect(reject.path == "/v1/knowledge/revisions/rev-1/reject")
    #expect(reject.method == .post)
    #expect(neighborhood.path == "/v1/knowledge/documents/doc-1/neighborhood")
    #expect(compileJobs.path == "/v1/knowledge/compile-jobs")
    #expect(compileJobs.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(audit.path == "/v1/knowledge/audit")
    #expect(audit.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
  }

  @Test("Mail, Calendar, and Todos endpoints encode filters")
  func lifeDomainEndpoints() {
    let emailSync = Endpoint.syncEmail
    let calendarSync = Endpoint.syncCalendar
    let todoSync = Endpoint.syncTodos
    let emailThreads = Endpoint.emailThreads(accountId: "acct-email-1", limit: 25, unreadOnly: true)
    let emailDigest = Endpoint.emailDigest(accountId: "acct-email-1")
    let calendarEvents = Endpoint.calendarEvents(
      accountId: "acct-cal-1",
      dateFrom: "2026-04-01T00:00:00Z",
      dateTo: "2026-04-08T00:00:00Z",
      limit: 40
    )
    let calendarDigest = Endpoint.calendarDigest(accountId: "acct-cal-1")
    let todoItems = Endpoint.todoItems(accountId: "acct-todo-1", project: "Inbox", limit: 75)
    let todoProjects = Endpoint.todoProjects(accountId: "acct-todo-1")
    let todoDigest = Endpoint.todoDigest(accountId: "acct-todo-1")
    let todoComplete = Endpoint.completeTodo(id: "todo-1")
    let todoReprioritize = Endpoint.reprioritizeTodo(id: "todo-1")
    let todoReschedule = Endpoint.rescheduleTodo(id: "todo-1")
    let todoMove = Endpoint.moveTodo(id: "todo-1")
    let todoReconcile = Endpoint.reconcileTodos

    #expect(emailThreads.path == "/v1/email/threads")
    #expect(emailSync.path == "/v1/email/sync")
    #expect(emailSync.method == .post)
    #expect(
      emailThreads.queryItems.contains(URLQueryItem(name: "accountId", value: "acct-email-1")))
    #expect(emailThreads.queryItems.contains(URLQueryItem(name: "limit", value: "25")))
    #expect(emailThreads.queryItems.contains(URLQueryItem(name: "unreadOnly", value: "true")))
    #expect(emailDigest.path == "/v1/email/digest")

    #expect(calendarEvents.path == "/v1/calendar/events")
    #expect(calendarSync.path == "/v1/calendar/sync")
    #expect(calendarSync.method == .post)
    #expect(
      calendarEvents.queryItems.contains(URLQueryItem(name: "accountId", value: "acct-cal-1")))
    #expect(
      calendarEvents.queryItems.contains(
        URLQueryItem(name: "dateFrom", value: "2026-04-01T00:00:00Z")))
    #expect(
      calendarEvents.queryItems.contains(
        URLQueryItem(name: "dateTo", value: "2026-04-08T00:00:00Z")))
    #expect(calendarEvents.queryItems.contains(URLQueryItem(name: "limit", value: "40")))
    #expect(calendarDigest.path == "/v1/calendar/digest")

    #expect(todoItems.path == "/v1/todos/items")
    #expect(todoSync.path == "/v1/todos/sync")
    #expect(todoSync.method == .post)
    #expect(todoItems.queryItems.contains(URLQueryItem(name: "accountId", value: "acct-todo-1")))
    #expect(todoItems.queryItems.contains(URLQueryItem(name: "project", value: "Inbox")))
    #expect(todoItems.queryItems.contains(URLQueryItem(name: "limit", value: "75")))
    #expect(todoProjects.path == "/v1/todos/projects")
    #expect(todoProjects.queryItems.contains(URLQueryItem(name: "accountId", value: "acct-todo-1")))
    #expect(todoDigest.path == "/v1/todos/digest")
    #expect(todoComplete.path == "/v1/todos/items/todo-1/complete")
    #expect(todoComplete.method == .post)
    #expect(todoReprioritize.path == "/v1/todos/items/todo-1/reprioritize")
    #expect(todoReprioritize.method == .post)
    #expect(todoReschedule.path == "/v1/todos/items/todo-1/reschedule")
    #expect(todoReschedule.method == .post)
    #expect(todoMove.path == "/v1/todos/items/todo-1/move")
    #expect(todoMove.method == .post)
    #expect(todoReconcile.path == "/v1/todos/reconcile")
    #expect(todoReconcile.method == .post)
  }

  @Test("People and files endpoints encode filters")
  func peopleAndFilesEndpoints() {
    let peopleSearch = Endpoint.peopleSearch(query: "annie", limit: 15)
    let person = Endpoint.person(id: "person-1")
    let personActivity = Endpoint.personActivity(id: "person-1")
    let mergeEvents = Endpoint.personMergeEvents(id: "person-1")
    let mergePeople = Endpoint.mergePeople
    let splitPerson = Endpoint.splitPerson(id: "person-1")
    let attachIdentity = Endpoint.attachPersonIdentity
    let detachIdentity = Endpoint.detachPersonIdentity(id: "identity-1")
    let fileRoots = Endpoint.fileRoots(workspaceId: "default")
    let createFileRoot = Endpoint.createFileRoot
    let updateFileRoot = Endpoint.updateFileRoot(id: "root-1")
    let deleteFileRoot = Endpoint.deleteFileRoot(id: "root-1")
    let reindexFileRoot = Endpoint.reindexFileRoot(id: "root-1")
    let fileSearch = Endpoint.fileSearch(
      query: "design", rootId: "root-1", workspaceId: "default", limit: 25)
    let fileWriteIntents = Endpoint.fileWriteIntents(rootId: "root-1", status: "pending")
    let reviewWriteIntent = Endpoint.reviewFileWriteIntent(id: "intent-1")
    let vaults = Endpoint.vaults(domain: "finance")

    #expect(peopleSearch.path == "/v1/people/search")
    #expect(peopleSearch.queryItems.contains(URLQueryItem(name: "query", value: "annie")))
    #expect(peopleSearch.queryItems.contains(URLQueryItem(name: "limit", value: "15")))
    #expect(person.path == "/v1/people/person-1")
    #expect(personActivity.path == "/v1/people/person-1/activity")
    #expect(mergeEvents.path == "/v1/people/person-1/merge-events")
    #expect(mergePeople.path == "/v1/people/merge")
    #expect(mergePeople.method == .post)
    #expect(splitPerson.path == "/v1/people/person-1/split")
    #expect(splitPerson.method == .post)
    #expect(attachIdentity.path == "/v1/people/identities/attach")
    #expect(detachIdentity.path == "/v1/people/identities/identity-1/detach")

    #expect(fileRoots.path == "/v1/files/roots")
    #expect(fileRoots.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(createFileRoot.path == "/v1/files/roots")
    #expect(createFileRoot.method == .post)
    #expect(updateFileRoot.path == "/v1/files/roots/root-1")
    #expect(updateFileRoot.method == .patch)
    #expect(deleteFileRoot.path == "/v1/files/roots/root-1")
    #expect(deleteFileRoot.method == .delete)
    #expect(reindexFileRoot.path == "/v1/files/roots/root-1/reindex")
    #expect(reindexFileRoot.method == .post)
    #expect(fileSearch.path == "/v1/files/search")
    #expect(fileSearch.queryItems.contains(URLQueryItem(name: "query", value: "design")))
    #expect(fileSearch.queryItems.contains(URLQueryItem(name: "rootId", value: "root-1")))
    #expect(fileSearch.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(fileSearch.queryItems.contains(URLQueryItem(name: "limit", value: "25")))
    #expect(fileWriteIntents.path == "/v1/files/write-intents")
    #expect(fileWriteIntents.queryItems.contains(URLQueryItem(name: "rootId", value: "root-1")))
    #expect(fileWriteIntents.queryItems.contains(URLQueryItem(name: "status", value: "pending")))
    #expect(reviewWriteIntent.path == "/v1/files/write-intents/intent-1/review")
    #expect(reviewWriteIntent.method == .post)
    #expect(vaults.path == "/v1/vaults")
    #expect(vaults.queryItems.contains(URLQueryItem(name: "domain", value: "finance")))
  }

  @Test("Finance and medical endpoints encode filters")
  func restrictedDomainEndpoints() {
    let financeTransactions = Endpoint.financeTransactions(
      importId: "import-1", category: "travel", dateFrom: "2026-03-01", dateTo: "2026-03-31",
      limit: 30)
    let financeDocuments = Endpoint.financeDocuments(importId: "import-1")
    let financeSearch = Endpoint.financeSearch(
      query: "flight", category: "travel", dateFrom: "2026-03-01", dateTo: "2026-03-31", limit: 10)
    let financeDigest = Endpoint.financeDigest(period: "month")
    let createFinanceImport = Endpoint.createFinanceImport
    let createFinanceTransaction = Endpoint.createFinanceTransaction
    let updateFinanceImport = Endpoint.updateFinanceImportStatus(id: "import-1")
    let openVault = Endpoint.openVault(id: "vault-1")
    let closeVault = Endpoint.closeVault(id: "vault-1")

    let medicalAppointments = Endpoint.medicalAppointments(importId: "import-med-1", limit: 20)
    let medicalMedications = Endpoint.medicalMedications(importId: "import-med-1")
    let medicalDocuments = Endpoint.medicalDocuments(importId: "import-med-1")
    let medicalSearch = Endpoint.medicalSearch(query: "prescription", limit: 12)
    let medicalDigest = Endpoint.medicalDigest(period: "quarter")
    let createMedicalImport = Endpoint.createMedicalImport
    let createMedicalAppointment = Endpoint.createMedicalAppointment
    let createMedicalMedication = Endpoint.createMedicalMedication
    let createMedicalDocument = Endpoint.createMedicalDocument
    let updateMedicalImport = Endpoint.updateMedicalImportStatus(id: "import-med-1")

    #expect(financeTransactions.path == "/v1/finance/transactions")
    #expect(
      financeTransactions.queryItems.contains(URLQueryItem(name: "importId", value: "import-1")))
    #expect(
      financeTransactions.queryItems.contains(URLQueryItem(name: "category", value: "travel")))
    #expect(
      financeTransactions.queryItems.contains(URLQueryItem(name: "dateFrom", value: "2026-03-01")))
    #expect(
      financeTransactions.queryItems.contains(URLQueryItem(name: "dateTo", value: "2026-03-31")))
    #expect(financeTransactions.queryItems.contains(URLQueryItem(name: "limit", value: "30")))
    #expect(financeDocuments.path == "/v1/finance/documents")
    #expect(financeDocuments.queryItems.contains(URLQueryItem(name: "importId", value: "import-1")))
    #expect(financeSearch.path == "/v1/finance/search")
    #expect(financeSearch.queryItems.contains(URLQueryItem(name: "query", value: "flight")))
    #expect(financeSearch.queryItems.contains(URLQueryItem(name: "limit", value: "10")))
    #expect(financeDigest.path == "/v1/finance/digest")
    #expect(financeDigest.queryItems.contains(URLQueryItem(name: "period", value: "month")))
    #expect(createFinanceImport.path == "/v1/finance/imports")
    #expect(createFinanceImport.method == .post)
    #expect(createFinanceTransaction.path == "/v1/finance/transactions")
    #expect(createFinanceTransaction.method == .post)
    #expect(updateFinanceImport.path == "/v1/finance/imports/import-1/status")
    #expect(updateFinanceImport.method == .post)
    #expect(openVault.path == "/v1/vaults/vault-1/open")
    #expect(closeVault.path == "/v1/vaults/vault-1/close")

    #expect(medicalAppointments.path == "/v1/medical/appointments")
    #expect(
      medicalAppointments.queryItems.contains(URLQueryItem(name: "importId", value: "import-med-1"))
    )
    #expect(medicalAppointments.queryItems.contains(URLQueryItem(name: "limit", value: "20")))
    #expect(medicalMedications.path == "/v1/medical/medications")
    #expect(
      medicalMedications.queryItems.contains(URLQueryItem(name: "importId", value: "import-med-1")))
    #expect(medicalDocuments.path == "/v1/medical/documents")
    #expect(
      medicalDocuments.queryItems.contains(URLQueryItem(name: "importId", value: "import-med-1")))
    #expect(medicalSearch.path == "/v1/medical/search")
    #expect(medicalSearch.queryItems.contains(URLQueryItem(name: "query", value: "prescription")))
    #expect(medicalSearch.queryItems.contains(URLQueryItem(name: "limit", value: "12")))
    #expect(medicalDigest.path == "/v1/medical/digest")
    #expect(medicalDigest.queryItems.contains(URLQueryItem(name: "period", value: "quarter")))
    #expect(createMedicalImport.path == "/v1/medical/imports")
    #expect(createMedicalImport.method == .post)
    #expect(createMedicalAppointment.path == "/v1/medical/appointments")
    #expect(createMedicalMedication.path == "/v1/medical/medications")
    #expect(createMedicalDocument.path == "/v1/medical/documents")
    #expect(updateMedicalImport.path == "/v1/medical/imports/import-med-1/status")
    #expect(updateMedicalImport.method == .post)
  }

  @Test("Memory list endpoint encodes optional filters")
  func memoryListEndpoint() {
    let endpoint = Endpoint.memories(
      type: "semantic",
      scope: "default",
      workspaceId: "default",
      projectId: "proj-1",
      includeGlobal: true,
      limit: 200
    )

    #expect(endpoint.path == "/v1/memory")
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "type", value: "semantic")))
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "scope", value: "default")))
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "workspaceId", value: "default")))
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "projectId", value: "proj-1")))
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "includeGlobal", value: "true")))
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "limit", value: "200")))
  }

  @Test("Memory search endpoint encodes workspace-aware filters once")
  func memorySearchEndpoint() {
    let endpoint = Endpoint.memorySearch(
      query: "triage",
      limit: 50,
      scope: "default",
      workspaceId: "workspace-2",
      types: "semantic",
      domains: "coding"
    )

    #expect(endpoint.path == "/v1/memory/search")
    #expect(endpoint.queryItems.filter { $0.name == "workspaceId" }.count == 1)
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "workspaceId", value: "workspace-2")))
    #expect(endpoint.queryItems.contains(URLQueryItem(name: "limit", value: "50")))
  }
}
