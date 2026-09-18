using System.Drawing.Drawing2D;

namespace CrmYnov.TelephonyAgent;

internal sealed class MainForm : Form
{
    private static readonly Color Navy = Color.FromArgb(7, 34, 68);
    private static readonly Color Teal = Color.FromArgb(21, 177, 168);
    private static readonly Color Surface = Color.FromArgb(246, 249, 251);
    private static readonly Color Muted = Color.FromArgb(93, 111, 128);
    private readonly DpapiStore store;
    private readonly AgentSetup setup;
    private readonly AgentRuntime runtime;
    private readonly NotifyIcon tray;
    private readonly Label crmValue = StatusValue();
    private readonly Label stationValue = StatusValue();
    private readonly Label sipValue = StatusValue();
    private readonly Label identityValue = new() { AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Navy };
    private readonly Label extensionValue = new() { AutoSize = true, ForeColor = Muted };
    private readonly Label callValue = new() { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), ForeColor = Navy };
    private readonly Label durationValue = new() { AutoSize = true, ForeColor = Muted };
    private readonly ProgressBar microphoneLevel = new() { Minimum = 0, Maximum = 100, Width = 250, Height = 18 };
    private readonly ComboBox inputDevices = DeviceCombo();
    private readonly ComboBox outputDevices = DeviceCombo();
    private readonly TextBox apiUrl = Field("http://127.0.0.1:43216");
    private readonly TextBox pairingCode = Field("");
    private readonly TextBox workstationName = Field(Environment.MachineName);
    private readonly TextBox sipPassword = Field("");
    private readonly Label feedback = new() { AutoSize = true, MaximumSize = new Size(760, 0), ForeColor = Muted };
    private readonly Button startButton = ActionButton("Démarrer l’agent", true);
    private readonly Button stopButton = ActionButton("Arrêter l’agent", false);
    private readonly Button muteButton = ActionButton("Couper le micro", false);
    private readonly Button hangupButton = ActionButton("Raccrocher", false);
    private bool allowClose;
    private AgentRuntimeSnapshot snapshot = new(false, false, false, false, "ARRÊTÉ", null, null, false, 0, [], null, null);

    public MainForm(DpapiStore store)
    {
        this.store = store;
        setup = new AgentSetup(store);
        runtime = new AgentRuntime(store);
        runtime.SnapshotChanged += OnSnapshotChanged;

        Text = "CRM Ynov · Agent téléphonique";
        Icon = SystemIcons.Application;
        BackColor = Surface;
        ForeColor = Navy;
        Font = new Font("Segoe UI", 9.5f);
        MinimumSize = new Size(860, 680);
        Size = new Size(960, 760);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        tray = new NotifyIcon {
            Icon = SystemIcons.Application,
            Text = "CRM Ynov · Agent téléphonique",
            Visible = true,
            ContextMenuStrip = BuildTrayMenu(),
        };
        tray.DoubleClick += (_, _) => RestoreWindow();

        Controls.Add(BuildLayout());
        FormClosing += OnFormClosing;
        Shown += (_, _) => RefreshIdentity();
    }

    private Control BuildLayout()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(24), ColumnCount = 1, RowCount = 4, AutoScroll = true };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        root.Controls.Add(BuildHeader());
        root.Controls.Add(BuildStatusStrip());
        root.Controls.Add(BuildCallPanel());
        root.Controls.Add(BuildTabs());
        return root;
    }

    private Control BuildHeader()
    {
        var panel = Card(); panel.Padding = new Padding(20); panel.Margin = new Padding(0, 0, 0, 14);
        var layout = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 2 };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var title = new Label { AutoSize = true, Text = "Agent téléphonique", Font = new Font("Segoe UI", 21, FontStyle.Bold), ForeColor = Navy };
        var subtitle = new Label { AutoSize = true, Text = "Appels sortants tracés depuis le CRM · réception et enregistrement désactivés", ForeColor = Muted, Margin = new Padding(0, 4, 0, 0) };
        var text = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        text.Controls.Add(new Label { AutoSize = true, Text = "RELATION YNOV", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal }); text.Controls.Add(title); text.Controls.Add(subtitle);
        var actions = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, Anchor = AnchorStyles.Right };
        startButton.Click += async (_, _) => await StartAgentAsync(); stopButton.Click += async (_, _) => await StopAgentAsync();
        actions.Controls.Add(startButton); actions.Controls.Add(stopButton);
        layout.Controls.Add(text, 0, 0); layout.Controls.Add(actions, 1, 0); panel.Controls.Add(layout); return panel;
    }

    private Control BuildStatusStrip()
    {
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 3, Margin = new Padding(0, 0, 0, 14) };
        for (var i = 0; i < 3; i++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 33.33f));
        grid.Controls.Add(StatusCard("CRM", crmValue), 0, 0); grid.Controls.Add(StatusCard("POSTE", stationValue), 1, 0); grid.Controls.Add(StatusCard("SIP", sipValue), 2, 0);
        return grid;
    }

    private Control BuildCallPanel()
    {
        var panel = Card(); panel.Padding = new Padding(18); panel.Margin = new Padding(0, 0, 0, 14);
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 3 };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var text = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
        text.Controls.Add(new Label { AutoSize = true, Text = "APPEL COURANT", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal }); text.Controls.Add(callValue); text.Controls.Add(durationValue);
        muteButton.Click += (_, _) => runtime.SetMuted(!snapshot.Muted); hangupButton.Click += (_, _) => runtime.Hangup();
        row.Controls.Add(text, 0, 0); row.Controls.Add(muteButton, 1, 0); row.Controls.Add(hangupButton, 2, 0); panel.Controls.Add(row); return panel;
    }

    private Control BuildTabs()
    {
        var tabs = new TabControl { Dock = DockStyle.Fill, Padding = new Point(14, 7) };
        tabs.TabPages.Add(Tab("Association", BuildPairingPage()));
        tabs.TabPages.Add(Tab("Compte SIP", BuildSipPage()));
        tabs.TabPages.Add(Tab("Audio", BuildAudioPage()));
        tabs.TabPages.Add(Tab("Diagnostic", BuildDiagnosticPage()));
        return tabs;
    }

    private Control BuildPairingPage()
    {
        pairingCode.UseSystemPasswordChar = true;
        var form = FormStack();
        form.Controls.Add(SectionTitle("Associer ce poste au compte CRM", "Le code temporaire vient de l’administration Téléphonie du CRM. Il n’est utilisable qu’une fois."));
        form.Controls.Add(Labeled("Adresse de l’API CRM", apiUrl));
        form.Controls.Add(Labeled("Code d’association", pairingCode));
        form.Controls.Add(Labeled("Nom du poste", workstationName));
        var button = ActionButton("Associer le poste", true); button.Click += async (_, _) => await PairAsync(); form.Controls.Add(button);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildSipPage()
    {
        sipPassword.UseSystemPasswordChar = true;
        var form = FormStack();
        form.Controls.Add(SectionTitle("Identité téléphonique locale", "Le mot de passe SIP reste chiffré par DPAPI pour cet utilisateur Windows et n’est jamais envoyé au CRM."));
        form.Controls.Add(Labeled("Utilisateur CRM", identityValue));
        form.Controls.Add(Labeled("Extension SIP", extensionValue));
        form.Controls.Add(Labeled("Mot de passe SIP", sipPassword));
        var button = ActionButton("Protéger le secret localement", true); button.Click += (_, _) => ConfigureSecret(); form.Controls.Add(button);
        return form;
    }

    private Control BuildAudioPage()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Périphériques audio", "La jauge reflète le niveau mesuré par Liblinphone pendant un appel ; aucun audio n’est enregistré."));
        form.Controls.Add(Labeled("Microphone", inputDevices)); form.Controls.Add(Labeled("Haut-parleur ou casque", outputDevices));
        form.Controls.Add(Labeled("Niveau microphone", microphoneLevel));
        var apply = ActionButton("Appliquer les périphériques", true); apply.Click += (_, _) => ApplyDevices(); form.Controls.Add(apply);
        form.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(720, 0), ForeColor = Muted, Text = "Diagnostic WASAPI : l’application s’exécute en STA afin d’éviter le conflit COM observé par le pilote console. Les changements de périphérique sont relus par le SDK." });
        return form;
    }

    private Control BuildDiagnosticPage()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Diagnostic expurgé", "L’export exclut secrets, jetons, numéros, adresse SIP, identifiants et noms de périphériques."));
        var export = ActionButton("Exporter le diagnostic", false); export.Click += (_, _) => ExportDiagnostic(); form.Controls.Add(export);
        var autoStart = new CheckBox { AutoSize = true, Text = "Démarrer automatiquement avec ma session Windows", Checked = StartupManager.Enabled, Margin = new Padding(0, 12, 0, 0) };
        autoStart.CheckedChanged += (_, _) => { try { StartupManager.Enabled = autoStart.Checked; } catch { autoStart.Checked = StartupManager.Enabled; ShowFeedback("Le démarrage automatique n’a pas pu être modifié.", true); } };
        form.Controls.Add(autoStart);
        form.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(720, 0), ForeColor = Muted, Text = "Le CRM reste le seul composeur. Cet agent ne propose aucune saisie libre de numéro et refuse les appels entrants." });
        return form;
    }

    private async Task PairAsync()
    {
        if (string.IsNullOrWhiteSpace(apiUrl.Text) || string.IsNullOrWhiteSpace(pairingCode.Text) || string.IsNullOrWhiteSpace(workstationName.Text)) { ShowFeedback("Renseignez l’API, le code et le nom du poste.", true); return; }
        try {
            await runtime.StopAsync();
            await setup.PairAsync(apiUrl.Text, pairingCode.Text, workstationName.Text, CancellationToken.None);
            pairingCode.Clear(); RefreshIdentity(); ShowFeedback("Poste associé. Configurez le secret SIP local avant de démarrer l’agent.", false);
        } catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void ConfigureSecret()
    {
        try { setup.ConfigureSecret(sipPassword.Text); sipPassword.Clear(); RefreshIdentity(); ShowFeedback("Secret SIP protégé localement. Aucun appel n’a été lancé.", false); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private async Task StartAgentAsync()
    {
        try { await runtime.StartAsync(); ShowFeedback("Agent démarré. Sa disponibilité sera confirmée par le CRM et l’enregistrement SIP.", false); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private async Task StopAgentAsync()
    {
        try { await runtime.StopAsync(); ShowFeedback("Agent arrêté proprement. Aucun appel ne sera composé.", false); }
        catch { ShowFeedback("L’arrêt n’a pas pu être confirmé.", true); }
    }

    private void ApplyDevices()
    {
        var input = inputDevices.SelectedItem as AudioDeviceItem; var output = outputDevices.SelectedItem as AudioDeviceItem;
        runtime.ApplyDevices(input?.Id, output?.Id); ShowFeedback("Périphériques appliqués et conservés localement.", false);
    }

    private void ExportDiagnostic()
    {
        using var dialog = new SaveFileDialog { Filter = "Diagnostic JSON (*.json)|*.json", FileName = $"crm-ynov-telephonie-{DateTime.Now:yyyyMMdd-HHmmss}.json", AddExtension = true, DefaultExt = "json" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var settings = store.Load(); DiagnosticsExporter.Export(dialog.FileName, snapshot, settings is not null, settings?.SipPassword.Length > 0);
        ShowFeedback("Diagnostic expurgé exporté.", false);
    }

    private void OnSnapshotChanged(AgentRuntimeSnapshot next)
    {
        if (InvokeRequired) { BeginInvoke(() => OnSnapshotChanged(next)); return; }
        snapshot = next;
        crmValue.Text = next.CrmConnected ? "Connecté" : next.Running ? "Injoignable" : "Arrêté";
        stationValue.Text = next.Running && next.SdkLoaded ? "Autorisé · SDK chargé" : setup.Settings is null ? "Non associé" : "Associé · agent arrêté";
        sipValue.Text = next.SipRegistered ? "Enregistré" : next.Running ? "Non enregistré" : "Hors ligne";
        callValue.Text = CallLabel(next.CallState); durationValue.Text = next.CallDurationSeconds is int seconds ? $"Durée observée : {seconds / 60:00}:{seconds % 60:00}" : "Aucun appel actif";
        microphoneLevel.Value = Math.Clamp(next.MicrophoneLevel, 0, 100);
        muteButton.Text = next.Muted ? "Rétablir le micro" : "Couper le micro";
        var activeCall = next.CallState is "DIALING" or "RINGING" or "ANSWERED" or "REQUESTED";
        muteButton.Enabled = next.CallState == "ANSWERED"; hangupButton.Enabled = activeCall;
        startButton.Enabled = !next.Running; stopButton.Enabled = next.Running;
        RefreshDevices(next);
    }

    private void RefreshDevices(AgentRuntimeSnapshot next)
    {
        var signature = string.Join('|', next.Devices.Select(item => item.Id));
        if (Equals(inputDevices.Tag, signature) && Equals(outputDevices.Tag, signature)) return;
        FillDevices(inputDevices, next.Devices.Where(item => item.CanRecord), next.InputDeviceId);
        FillDevices(outputDevices, next.Devices.Where(item => item.CanPlay), next.OutputDeviceId);
        inputDevices.Tag = signature; outputDevices.Tag = signature;
    }

    private void RefreshIdentity()
    {
        var settings = setup.Settings;
        identityValue.Text = settings is null ? "Poste non associé" : Environment.UserName;
        extensionValue.Text = settings is null ? "Non configurée" : MaskSip(settings.SipAddress);
        apiUrl.Text = settings?.ApiBaseUrl ?? apiUrl.Text;
        OnSnapshotChanged(runtime.Snapshot);
    }

    private async void OnFormClosing(object? sender, FormClosingEventArgs eventArgs)
    {
        if (!allowClose && eventArgs.CloseReason == CloseReason.UserClosing) { eventArgs.Cancel = true; Hide(); tray.ShowBalloonTip(1500, "CRM Ynov", "L’agent reste accessible dans la zone de notification.", ToolTipIcon.Info); return; }
        tray.Visible = false;
        await runtime.DisposeAsync();
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Ouvrir", null, (_, _) => RestoreWindow());
        menu.Items.Add("Quitter", null, async (_, _) => { allowClose = true; await runtime.StopAsync(); tray.Visible = false; Close(); });
        return menu;
    }

    private void RestoreWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    private void ShowFeedback(string message, bool error) { feedback.Text = message; feedback.ForeColor = error ? Color.FromArgb(181, 45, 48) : Color.FromArgb(10, 116, 104); }

    private static string HumanError(Exception error) => error switch {
        HttpRequestException http when http.StatusCode is not null => $"Le CRM a refusé l’opération ({(int)http.StatusCode}). Rechargez l’état avant de recommencer.",
        InvalidOperationException invalid when invalid.Message == "AGENT_NOT_PAIRED" => "Associez d’abord ce poste au CRM.",
        InvalidOperationException invalid when invalid.Message == "SIP_SECRET_MISSING" => "Configurez le mot de passe SIP localement.",
        InvalidOperationException invalid when invalid.Message == "SIP_SECRET_EMPTY" => "Le mot de passe SIP ne peut pas être vide.",
        _ => "L’opération n’a pas pu être confirmée. Aucun appel n’a été lancé.",
    };
    private static string CallLabel(string? state) => state switch { "DIALING" => "Numérotation demandée", "RINGING" => "Le poste distant sonne", "ANSWERED" => "Communication établie", "ENDED" => "Appel terminé", "FAILED" => "Échec de l’appel", "MISSED" => "Sans réponse", "CANCELLED" => "Appel annulé", _ => "Aucun appel en cours" };
    private static string MaskSip(string value) { var at = value.IndexOf('@'); return at < 0 ? "Extension configurée" : $"•••@{value[(at + 1)..]}"; }

    private static Panel Card() => new() { Dock = DockStyle.Top, AutoSize = true, BackColor = Color.White, BorderStyle = BorderStyle.FixedSingle };
    private static Label StatusValue() => new() { AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Navy };
    private static Control StatusCard(string label, Control value) { var panel = Card(); panel.Padding = new Padding(16); panel.Margin = new Padding(0, 0, 10, 0); var stack = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false }; stack.Controls.Add(new Label { AutoSize = true, Text = label, Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal }); stack.Controls.Add(value); panel.Controls.Add(stack); return panel; }
    private static TabPage Tab(string title, Control content) { var page = new TabPage(title) { BackColor = Surface, Padding = new Padding(18), AutoScroll = true }; page.Controls.Add(content); return page; }
    private static FlowLayoutPanel FormStack() => new() { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(4) };
    private static Control SectionTitle(string title, string description) { var panel = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = new Padding(0, 0, 0, 16) }; panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 15, FontStyle.Bold), ForeColor = Navy }); panel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(720, 0), Text = description, ForeColor = Muted }); return panel; }
    private static Control Labeled(string label, Control control) { control.Width = 520; var panel = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = new Padding(0, 0, 0, 12) }; panel.Controls.Add(new Label { AutoSize = true, Text = label, Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = Navy }); panel.Controls.Add(control); return panel; }
    private static TextBox Field(string value) => new() { Text = value, Width = 520, BorderStyle = BorderStyle.FixedSingle };
    private static ComboBox DeviceCombo() => new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 520 };
    private static Button ActionButton(string text, bool primary) { var button = new Button { AutoSize = true, Text = text, FlatStyle = FlatStyle.Flat, Padding = new Padding(13, 7, 13, 7), Margin = new Padding(6) }; button.FlatAppearance.BorderColor = primary ? Teal : Color.FromArgb(192, 204, 214); button.BackColor = primary ? Teal : Color.White; button.ForeColor = primary ? Color.White : Navy; return button; }
    private static void FillDevices(ComboBox combo, IEnumerable<AudioDeviceView> devices, string? selectedId) { combo.Items.Clear(); foreach (var item in devices) combo.Items.Add(new AudioDeviceItem(item.Id, item.Name)); var selected = combo.Items.Cast<AudioDeviceItem>().FirstOrDefault(item => item.Id == selectedId); combo.SelectedItem = selected ?? (combo.Items.Count > 0 ? combo.Items[0] : null); }

    private sealed record AudioDeviceItem(string Id, string Label) { public override string ToString() => Label; }
}
