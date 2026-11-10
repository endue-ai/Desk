//! `Core::dispatch`: each bridge request to the method that serves it, after its params were read
//! into the generated types. Methods the core does not serve yet answer `unsupported`.

use desk_bridge::{BridgeRequest, Encoding, FsReadParams, Permission, RequestId};

use crate::core_fs::{list, read};
use crate::handler::{Answer, Core, unsupported};

impl Core {
    pub(crate) fn dispatch(&self, caller: &str, request: BridgeRequest) -> (RequestId, Answer) {
        use BridgeRequest as R;
        match request {
            R::FsRead(r) => {
                let FsReadParams {
                    path,
                    encoding,
                    offset,
                    length,
                    scope,
                } = r.params;
                let answer = self
                    .authorize(caller, &Permission::FsRead(scope), &path)
                    .and_then(|path| {
                        let encoding = encoding.unwrap_or(Encoding::Utf8);
                        read(&path, encoding, offset.unwrap_or(0), length)
                    });
                (r.id, answer)
            }
            R::FsList(r) => {
                let scope = Permission::FsRead(r.params.scope);
                let answer = self
                    .authorize(caller, &scope, &r.params.path)
                    .and_then(|path| list(&path));
                (r.id, answer)
            }
            R::PermQuery(r) => (r.id, self.perm_query(caller, r.params)),
            R::PermRequest(r) => (r.id, self.perm_request(caller, r.params)),
            R::PermRevoke(r) => (r.id, self.perm_revoke(caller, r.params)),
            R::PermGrant(r) => (r.id, self.perm_grant(caller, r.params)),
            R::PermList(r) => (r.id, self.perm_list(caller, r.params)),
            R::PermAnswer(r) => (r.id, self.perm_answer(caller, r.params)),
            R::PermApprove(r) => (r.id, self.perm_approve(caller, r.params)),
            R::PluginList(r) => (r.id, self.plugin_list(caller, r.params)),
            R::PluginSetEnabled(r) => (r.id, self.plugin_set_enabled(caller, r.params)),
            R::MarketList(r) => (r.id, self.market_list(caller, r.params)),
            R::PluginInstall(r) => (r.id, self.plugin_install(caller, r.params)),
            R::PluginRemove(r) => (r.id, self.plugin_remove(caller, r.params)),
            R::PluginStats(r) => (r.id, self.plugin_stats(caller, r.params)),
            R::SearchReplace(r) => (r.id, self.search_replace(caller, r.params)),
            R::SearchQuery(r) => (r.id, self.search_query(caller, r.params)),
            R::SearchSystem(r) => (r.id, self.search_system(caller, r.params)),
            R::SearchOpen(r) => (r.id, self.search_open(caller, r.params)),
            R::StoreGet(r) => (r.id, self.store_get(caller, r.params)),
            R::StoreSet(r) => (r.id, self.store_set(caller, r.params)),
            R::BrainSay(r) => (r.id, self.brain_say(caller, r.params)),
            R::BrainAsk(r) => (r.id, self.brain_ask(caller, r.params)),
            R::BrainAgentsList(r) => (r.id, self.brain_agents_list(caller, r.params)),
            R::BrainAgentsCard(r) => (r.id, self.brain_agents_card(caller, r.params)),
            R::BrainSpacesList(r) => (r.id, self.brain_spaces_list(caller, r.params)),
            R::BrainTasksList(r) => (r.id, self.brain_tasks_list(caller, r.params)),
            R::BrainStatus(r) => (r.id, self.brain_status(caller, r.params)),
            R::InitGet(r) => (r.id, self.init_get(caller)),
            R::UiNotify(r) => (r.id, self.notify(caller, r.params)),
            R::FsWrite(r) => (r.id, self.fs_write(caller, r.params)),
            R::FsWatch(r) => (r.id, self.fs_watch(caller, r.params)),
            R::FsUrl(r) => (r.id, self.fs_url(caller, r.params)),
            R::FsHistory(r) => (r.id, self.fs_history(caller, r.params)),
            R::FsRestore(r) => (r.id, self.fs_restore(caller, r.params)),
            r @ (R::FsStat(_) | R::FsMkdir(_) | R::FsRename(_) | R::FsCopy(_) | R::FsTrash(_)) => {
                self.fs_op(caller, r)
            }
            R::ProcSpawn(r) => (r.id, self.proc_spawn(caller, r.params)),
            R::ProcWrite(r) => (r.id, self.proc_write(caller, r.params)),
            R::ProcResize(r) => (r.id, self.proc_resize(caller, r.params)),
            R::ProcKill(r) => (r.id, self.proc_kill(caller, r.params)),
            R::NetFetch(r) => (r.id, self.net_fetch(caller, r.params)),
            R::NetConnect(r) => (r.id, self.net_connect(caller, r.params)),
            R::NetSend(r) => (r.id, self.net_send(caller, r.params)),
            R::NetClose(r) => (r.id, self.net_close(caller, r.params)),
            R::AudioCaptureStart(r) => (r.id, unsupported("audio.capture.start")),
            R::AudioCaptureStop(r) => (r.id, unsupported("audio.capture.stop")),
            R::UiSurfaceOpen(r) => (r.id, self.surface_open(caller, r.params)),
            R::UiSurfaceClose(r) => (r.id, self.surface_close(caller, r.params)),
            R::UiSurfaceSnapshot(r) => (r.id, self.surface_snapshot(caller, r.params)),
            R::CmdRegister(r) => (r.id, self.cmd_register(caller, r.params)),
            R::CmdUnregister(r) => (r.id, self.cmd_unregister(caller, r.params)),
            R::CmdList(r) => (r.id, self.cmd_list(caller, r.params)),
            R::CmdInvoke(r) => (r.id, self.cmd_invoke(caller, r.params)),
            R::CmdAnswer(r) => (r.id, self.cmd_answer(caller, r.params)),
            R::CmdTools(r) => (r.id, self.cmd_tools(caller, r.params)),
            R::CmdRecent(r) => (r.id, self.cmd_recent(caller, r.params)),
            R::CmdUndo(r) => (r.id, self.cmd_undo(caller, r.params)),
            R::CmdRedo(r) => (r.id, self.cmd_redo(caller, r.params)),
            R::SettingsGet(r) => (r.id, self.settings_get(caller, r.params)),
            R::SettingsSet(r) => (r.id, self.settings_set(caller, r.params)),
            R::SettingsList(r) => (r.id, self.settings_list(caller, r.params)),
            R::LogWrite(r) => (r.id, self.log_write(caller, r.params)),
            R::LogTail(r) => (r.id, self.log_tail(caller, r.params)),
            R::EventsSubscribe(r) => (r.id, self.events_subscribe(caller, r.params)),
            R::EventsUnsubscribe(r) => (r.id, self.events_unsubscribe(caller, r.params)),
            R::DataQuery(r) => (r.id, self.data_query(caller, r.params)),
            R::DataGet(r) => (r.id, self.data_get(caller, r.params)),
            R::DataSubscribe(r) => (r.id, self.data_subscribe(caller, r.params)),
            R::DataUnsubscribe(r) => (r.id, self.data_unsubscribe(caller, r.params)),
            R::ConnectorList(r) => (r.id, self.connector_list(caller, r.params)),
            R::ConnectorConnect(r) => (r.id, self.connector_connect(caller, r.params)),
            R::ConnectorDisconnect(r) => (r.id, self.connector_disconnect(caller, r.params)),
            R::ConnectorSyncNow(r) => (r.id, self.connector_sync(caller, r.params)),
            R::ViewList(r) => (r.id, self.view_list(caller, r.params)),
            R::ViewGet(r) => (r.id, self.view_get(caller, r.params)),
            R::ViewSave(r) => (r.id, self.view_save(caller, r.params)),
            R::ViewRemove(r) => (r.id, self.view_remove(caller, r.params)),
            R::CatalogGet(r) => (r.id, self.catalog_get(caller)),
            R::ShellOpen(r) => (r.id, self.shell_open(caller, r.params)),
            R::UpdateStatus(r) => (r.id, self.update_status(caller, r.params)),
            R::UpdateCheck(r) => (r.id, self.update_check(caller, r.params)),
            R::UpdateDownload(r) => (r.id, self.update_download(caller, r.params)),
            R::UpdateApply(r) => (r.id, self.update_apply(caller, r.params)),
            R::UpdateSetChannel(r) => (r.id, self.update_set_channel(caller, r.params)),
            R::AccountStatus(r) => (r.id, self.account_status(caller, r.params)),
            R::AccountSignIn(r) => (r.id, self.account_sign_in(caller, r.params)),
            R::AccountSignOut(r) => (r.id, self.account_sign_out(caller, r.params)),
            R::AccountSettingsGet(r) => (r.id, self.account_settings_get(caller, r.params)),
            R::AccountSettingsUpdate(r) => (r.id, self.account_settings_update(caller, r.params)),
            R::AgentsList(r) => (r.id, self.agents_list(caller, r.params)),
            R::AgentsSessions(r) => (r.id, self.agents_sessions(caller, r.params)),
            R::AgentsTranscript(r) => (r.id, self.agents_transcript(caller, r.params)),
            R::AgentsImport(r) => (r.id, self.agents_import(caller, r.params)),
            R::AgentsAsk(r) => (r.id, self.agents_ask(caller, r.params)),
            R::AgentsRuns(r) => (r.id, self.agents_runs(caller, r.params)),
            R::AgentsStop(r) => (r.id, self.agents_stop(caller, r.params)),
            R::MemoryList(r) => (r.id, self.memory_list(caller, r.params)),
            R::MemoryGet(r) => (r.id, self.memory_get(caller, r.params)),
            R::MemoryRemember(r) => (r.id, self.memory_remember(caller, r.params)),
            R::MemoryForget(r) => (r.id, self.memory_forget(caller, r.params)),
            R::MemorySearch(r) => (r.id, self.memory_search(caller, r.params)),
            R::AgentList(r) => (r.id, self.agent_list(caller, r.params)),
            R::AgentCancel(r) => (r.id, self.agent_cancel(caller, r.params)),
            R::AgentReport(r) => (r.id, self.agent_report(caller, r.params)),
            R::ThemeSave(r) => (r.id, self.theme_save(caller, r.params)),
            R::ThemeImport(r) => (r.id, self.theme_import(caller, r.params)),
            R::ThemeExport(r) => (r.id, self.theme_export(caller, r.params)),
            R::ThemeRemove(r) => (r.id, self.theme_remove(caller, r.params)),
            R::ThemeMarketList(r) => (r.id, self.theme_market_list(caller, r.params)),
            R::ThemeMarketFetch(r) => (r.id, self.theme_market_fetch(caller, r.params)),
            R::ThemeTokens(r) => (r.id, self.theme_tokens_set(caller, r.params)),
            R::StudioAgentsList(r) => (r.id, self.studio_agents_list(caller, r.params)),
            R::StudioAgentsGet(r) => (r.id, self.studio_agents_get(caller, r.params)),
            R::StudioAgentsCreate(r) => (r.id, self.studio_agents_create(caller, r.params)),
            R::StudioAgentsUpdate(r) => (r.id, self.studio_agents_update(caller, r.params)),
            R::StudioAgentsSetStatus(r) => (r.id, self.studio_agents_set_status(caller, r.params)),
            R::StudioAgentsRemove(r) => (r.id, self.studio_agents_remove(caller, r.params)),
            R::StudioAgentsFacets(r) => (r.id, self.studio_agents_facets(caller, r.params)),
            R::StudioAgentsPromptUpdate(r) => (r.id, self.studio_prompt_update(caller, r.params)),
            R::StudioCatalogList(r) => (r.id, self.studio_catalog_list(caller, r.params)),
            R::StudioCatalogRecommend(r) => (r.id, self.studio_catalog_recommend(caller, r.params)),
            R::StudioCatalogUse(r) => (r.id, self.studio_catalog_use(caller, r.params)),
            R::StudioConversationsList(r) => {
                (r.id, self.studio_conversations_list(caller, r.params))
            }
            R::StudioSpacesList(r) => (r.id, self.studio_spaces_list(caller, r.params)),
            R::StudioSpacesGet(r) => (r.id, self.studio_spaces_get(caller, r.params)),
            r @ (R::ComputerPermissionsStatus(_)
            | R::ComputerPermissionsRequest(_)
            | R::ComputerPermissionsOpen(_)
            | R::ComputerScreenshot(_)
            | R::ComputerWindows(_)
            | R::ComputerAppsList(_)
            | R::ComputerAppsLaunch(_)
            | R::ComputerAppsActivate(_)
            | R::ComputerAppsQuit(_)
            | R::ComputerAxTree(_)
            | R::ComputerAxFind(_)
            | R::ComputerAxPerform(_)
            | R::ComputerInputClick(_)
            | R::ComputerInputMove(_)
            | R::ComputerInputDrag(_)
            | R::ComputerInputScroll(_)
            | R::ComputerInputType(_)
            | R::ComputerInputKeys(_)
            | R::ComputerStop(_)) => self.computer_call(caller, r),
        }
    }
}
