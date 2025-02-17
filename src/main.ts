import { MarkdownView, Notice, Platform, Plugin, WorkspaceLeaf, addIcon, moment } from "obsidian";
import { DEFAULT, Mode, View, HomepageSettings, HomepageSettingTab  } from "./settings";
import { getDailynotesAutorun, getNewTabPagePlugin, getWorkspacePlugin, getDataviewPlugin, trimFile, untrimName } from "./utils";

const ICON: string = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" xml:space="preserve" style="fill-rule:evenodd;clip-rule:evenodd;stroke-linecap:round;stroke-linejoin:round;stroke-miterlimit:1.5"><path d="M10.025 21H6v-7H3v-1.5L12 3l9 9.5V14h-3v7h-4v-7h-3.975v7Z" style="fill:none;stroke:currentColor;stroke-width:2px"/></svg>`
const LEAF_TYPES: string[] = ["markdown", "canvas", "kanban"];

export default class Homepage extends Plugin {
	settings: HomepageSettings;
	workspacePlugin: any;
	lastView: WeakRef<MarkdownView> = null;
	
	loaded: boolean = false;
	executing: boolean = false;
	
	homepage: string = "";

	async onload(): Promise<void> {
		let activeInitially = document.body.querySelector(".progress-bar") !== null;
		
		this.settings = Object.assign({}, DEFAULT, await this.loadData());
		this.workspacePlugin = getWorkspacePlugin(this.app);

		this.app.workspace.onLayoutReady(async () => {
			let ntp = getNewTabPagePlugin(this.app);

			if (ntp) {
				ntp._checkForNewTab = ntp.checkForNewTab;
				ntp.checkForNewTab = async (e: any) => {
					if (this && this.executing) { return; }
					return await ntp._checkForNewTab(e);
				}; 
			}
			
			if (activeInitially && this.settings.openOnStartup) await this.openHomepage();
			this.loaded = true;
		});

		addIcon("homepage", ICON);
		this.setIcon(this.settings.hasRibbonIcon);
		this.setReversion(this.settings.revertView);
		this.addSettingTab(new HomepageSettingTab(this.app, this));

		this.addCommand({
			id: "open-homepage",
			name: "Open homepage",
			callback: this.openHomepage,
		});

		console.log(
			`Homepage: ${this.getHomepageName()} `+
			`(method: ${this.settings.openMode}, view: ${this.settings.view}, `+
			`workspaces: ${this.settings.workspaceEnabled})`
		);
	}
	
	async onunload(): Promise<void> {
		let ntp = getNewTabPagePlugin(this.app);
		if (!ntp) return;
		ntp.checkForNewTab = ntp._checkForNewTab;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	setIcon(value: boolean): void {
		if (value) {
			this.addRibbonIcon("homepage", "Open homepage", this.openHomepage)
				.setAttribute("id", "nv-homepage-icon");
		}
		else {
			document.getElementById("nv-homepage-icon")?.remove();
		}
	}
	
	async setReversion(value: boolean): Promise<void> {
		if (value && this.settings.view !== View.Default) {
			this.registerEvent(this.app.workspace.on("layout-change", this.revertView));
		} 
		else {
			this.app.workspace.off("layout-change", this.revertView);
		}
	}
	
	openHomepage = async (): Promise<void> => {
		this.workspacesMode() ? await this.launchWorkspace() : await this.launchPage();
	}
	
	async launchWorkspace() {
		if(!(this.settings.workspace in this.workspacePlugin?.instance.workspaces)) {
			new Notice(`Cannot find the workspace "${this.settings.workspace}" to use as the homepage.`);
			return;
		}
		
		this.workspacePlugin.instance.loadWorkspace(this.settings.workspace);
	}

	async launchPage() {
		const mode = this.loaded ? this.settings.manualOpenMode : this.settings.openMode;
		const nonextant = async () => !(await this.app.vault.adapter.exists(untrimName(this.homepage)));
		const openLink = async (mode: Mode) => await this.app.workspace.openLinkText(
			this.homepage, "", mode == Mode.Retain, { active: true }
		);
		
		this.executing = true;
		this.homepage = this.getHomepageName();

		if (getDailynotesAutorun(this.app)) {
			new Notice(
				"Daily Notes' 'Open daily note on startup' setting is not compatible" +
				"  with Homepage. Disable one of the conflicting plugins."
			);
			return;
		}
		else if (!this.settings.autoCreate && await nonextant()) {
			new Notice(`Homepage "${this.homepage}" does not exist.`);
			return;
		}
		
		if (mode != Mode.ReplaceAll) {
			const alreadyOpened = this.getOpenedHomepages();

			if (alreadyOpened.length > 0) {
				this.app.workspace.setActiveLeaf(alreadyOpened[0]);
				await this.configureHomepage();
				return;
			}
		}
		else {
			if (this.settings.pin) {
				//hack to fix pin bug
				this.getOpenedHomepages().forEach(h => h.setPinned(false));
			}
			
			LEAF_TYPES.forEach(i => this.app.workspace.detachLeavesOfType(i));
		}
		
		await openLink(mode as Mode);
		
		if (this.app.workspace.getActiveFile() == null) {
			//hack to fix bug with opening link when homepage is already extant beforehand
			await openLink(mode as Mode);
		}

		await this.configureHomepage();
	}

	getHomepageName(): string {
		var homepage = this.settings.defaultNote;

		if (this.settings.useMoment) {
			homepage = moment().format(this.settings.momentFormat);
		}

		return homepage
	}

	getOpenedHomepages(): WorkspaceLeaf[] {
		let leaves = LEAF_TYPES.flatMap(i => this.app.workspace.getLeavesOfType(i));
		return leaves.filter(
			leaf => trimFile((leaf.view as any).file) == this.homepage
		);
	}

	async configureHomepage(): Promise<void> {
		this.executing = false;
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		
		if (!view) {
			//not ideal, but there is no canvas view type exposed afaik
			if (this.settings.pin) this.app.workspace.activeLeaf.setPinned(true);	
			return;	
		}
		
		const state = view.getState();
		
		if (this.settings.revertView) {
			this.lastView = new WeakRef(view);
		}

		if (this.settings.autoScroll) {
			const count = view.editor.lineCount();
			
			if (state.mode == "preview") {
				view.previewMode.applyScroll(count - 4);
			}
			else {
				view.editor.setCursor(count);
				view.editor.focus();
			}
		}	
		
		if (this.settings.pin) view.leaf.setPinned(true);	
		if (this.settings.view == View.Default) return;

		switch(this.settings.view) {
			case View.LivePreview:
			case View.Source:
				state.mode = "source";
				state.source = this.settings.view != View.LivePreview;
				break;
			case View.Reading:
				state.mode = "preview";
				break;
		}

		await view.leaf.setViewState({type: "markdown", state: state});
		if (this.loaded && this.settings.refreshDataview) { getDataviewPlugin(this.app)?.index.touch(); }
	}
	
	revertView = async (): Promise<void> => {
		if (!this.loaded || this.lastView == null) return;
		
		const view = this.lastView.deref();
		if (!view || trimFile(view.file) == this.homepage) return;

		const state = view.getState();
		const config = (this.app.vault as any).config;
		
		state.mode = config.defaultViewMode;
		state.source = !config.livePreview;
		await view.leaf.setViewState({type: "markdown", state: state});
		this.lastView = null;
	}

	workspacesMode(): boolean {
		return this.workspacePlugin?.enabled && this.settings.workspaceEnabled && !Platform.isMobile;
	}
}
