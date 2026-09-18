using System.Drawing.Drawing2D;
using System.Net;

namespace CrmYnov.TelephonyAgent;

internal sealed class MainForm : Form
{
    private static readonly Color Navy = Color.FromArgb(7, 34, 68);
    private static readonly Color Teal = Color.FromArgb(21, 177, 168);
    private static readonly Color Surface = Color.FromArgb(246, 249, 251);
    private static readonly Color Muted = Color.FromArgb(93, 111, 128);
    private static readonly Color Success = Color.FromArgb(10, 116, 104);
    private static readonly Color Danger = Color.FromArgb(181, 45, 48);

    private readonly DpapiStore store;
    private readonly AgentSetup setup;
    private readonly AgentRuntime runtime;
    private readonly NotifyIcon tray;
    private readonly Panel contentHost = new() { Dock = DockStyle.Fill, AutoScroll = true };
    private readonly Label feedback = new() { AutoSize = true, MaximumSize = new Size(760, 0), ForeColor = Muted, Margin = new Padding(0, 10, 0, 0) };
    private readonly System.Windows.Forms.Timer audioTimer = new() { Interval = 150 };

    private AgentRuntimeSnapshot snapshot = new(false, false, false, false, "ARRÊTÉ", null, null, false, 0, [], null, null);
    private ComboBox? inputDevices;
    private ComboBox? outputDevices;
    private ProgressBar? microphoneLevel;
    private Label? microphoneLevelText;
    private Button? microphoneTestButton;
    private CheckBox? localMonitoring;
    private Button? finishButton;
    private Label? readinessLabel;
    private Label? crmStatus;
    private Label? authorizationStatus;
    private Label? sipStatus;
    private Label? audioStatus;
    private Label? callValue;
    private Label? durationValue;
    private Label? accountDisplayValue;
    private Button? connectButton;
    private Button? disconnectButton;
    private TextBox? pairingCode;
    private TextBox? workstationName;
    private TextBox? sipPassword;
    private bool wizardVisible;
    private int wizardStep;
    private bool allowClose;

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
        MinimumSize = new Size(780, 650);
        Size = new Size(980, 780);
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;

        tray = new NotifyIcon {
            Icon = SystemIcons.Application,
            Text = "CRM Ynov · Agent téléphonique",
            Visible = true,
            ContextMenuStrip = BuildTrayMenu(),
        };
        tray.DoubleClick += (_, _) => RestoreWindow();

        Controls.Add(contentHost);
        FormClosing += OnFormClosing;
        Shown += async (_, _) => await InitializeViewAsync();
        audioTimer.Tick += (_, _) => runtime.TickAudio();
        audioTimer.Start();
    }

    private async Task InitializeViewAsync()
    {
        var settings = setup.Settings;
        if (settings is null) { wizardVisible = true; wizardStep = 0; }
        else if (settings.SipPassword.Length == 0) { wizardVisible = true; wizardStep = 1; }
        else if (!setup.IsProfileComplete(settings)) { wizardVisible = true; wizardStep = 3; }
        else { wizardVisible = false; wizardStep = 4; }

        Render();
        if (settings is not null && settings.SipPassword.Length > 0)
        {
            try { await runtime.EnsureAudioAsync(); }
            catch (Exception error) { ShowFeedback(HumanError(error), true); }
        }
    }

    private void Render()
    {
        contentHost.SuspendLayout();
        contentHost.Controls.Clear();
        inputDevices = null; outputDevices = null; microphoneLevel = null; microphoneLevelText = null; microphoneTestButton = null; localMonitoring = null;
        finishButton = null; readinessLabel = null; crmStatus = null; authorizationStatus = null; sipStatus = null; audioStatus = null;
        callValue = null; durationValue = null; connectButton = null; disconnectButton = null;
        accountDisplayValue = null;
        var view = wizardVisible ? BuildWizard() : BuildDashboard();
        contentHost.Controls.Add(view);
        contentHost.ResumeLayout(true);
        UpdateVisibleState();
    }

    private Control BuildWizard()
    {
        var root = Page();
        root.Controls.Add(BuildBrandHeader("Configurer mon poste", "Cinq étapes guidées, à réaliser une seule fois sur ce poste."));
        root.Controls.Add(BuildStepIndicator());
        var card = Card(); card.Padding = new Padding(26); card.Margin = new Padding(0, 0, 0, 16);
        card.Controls.Add(wizardStep switch {
            0 => BuildPairingStep(),
            1 => BuildProfileStep(),
            2 => BuildSecretStep(),
            3 => BuildAudioStep(true),
            _ => BuildAvailabilityStep(),
        });
        root.Controls.Add(card);
        return root;
    }

    private Control BuildStepIndicator()
    {
        var labels = new[] { "Compte CRM", "Profil", "Mot de passe", "Audio", "Disponibilité" };
        var row = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = labels.Length, Margin = new Padding(0, 0, 0, 16) };
        for (var index = 0; index < labels.Length; index++)
        {
            row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 20));
            row.Controls.Add(new Label {
                AutoSize = false, Dock = DockStyle.Fill, Height = 36, TextAlign = ContentAlignment.MiddleCenter,
                Text = $"{index + 1}. {labels[index]}", Font = new Font("Segoe UI", 8.5f, index == wizardStep ? FontStyle.Bold : FontStyle.Regular),
                BackColor = index <= wizardStep ? Color.FromArgb(225, 247, 244) : Color.White,
                ForeColor = index <= wizardStep ? Success : Muted, Margin = new Padding(index == 0 ? 0 : 4, 0, 0, 0),
            }, index, 0);
        }
        return row;
    }

    private Control BuildPairingStep()
    {
        pairingCode = Field(""); pairingCode.UseSystemPasswordChar = true; pairingCode.AccessibleName = "Code d’association temporaire";
        workstationName = Field(Environment.MachineName); workstationName.AccessibleName = "Nom du poste";
        var form = FormStack();
        form.Controls.Add(SectionTitle("Associer mon compte CRM", "Saisissez le code temporaire fourni dans l’administration Téléphonie. L’adresse du CRM est déjà configurée pour ce pilote."));
        form.Controls.Add(InfoBox("Environnement CRM", "Recette locale · paramètres techniques gérés par l’administration"));
        form.Controls.Add(Labeled("Code d’association", pairingCode));
        form.Controls.Add(Labeled("Nom de ce poste", workstationName));
        var button = ActionButton("Associer ce poste", true); button.Click += async (_, _) => await PairAsync(); form.Controls.Add(button);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildProfileStep()
    {
        var settings = setup.Settings;
        var form = FormStack();
        form.Controls.Add(SectionTitle("Confirmer mon profil téléphonique", "Vérifiez l’identité attribuée par l’administration avant d’enregistrer votre mot de passe téléphonique."));
        form.Controls.Add(SummaryRow("Compte CRM", AccountLabel(settings)));
        form.Controls.Add(SummaryRow("Poste", settings?.WorkstationDisplayName ?? Environment.MachineName));
        form.Controls.Add(SummaryRow("Profil téléphonique", settings is null ? "Non attribué" : MaskSip(settings.SipAddress)));
        form.Controls.Add(SummaryRow("Infrastructure", "Paramètres administrés · non modifiables ici"));
        var actions = ButtonRow();
        var reassociate = ActionButton("Utiliser un autre code", false); reassociate.Click += (_, _) => { wizardStep = 0; Render(); };
        var confirm = ActionButton("Confirmer ce profil", true); confirm.Click += (_, _) => { wizardStep = 2; Render(); };
        actions.Controls.Add(reassociate); actions.Controls.Add(confirm); form.Controls.Add(actions); form.Controls.Add(feedback);
        return form;
    }

    private Control BuildSecretStep()
    {
        sipPassword = Field(""); sipPassword.UseSystemPasswordChar = true; sipPassword.AccessibleName = "Mot de passe téléphonique";
        var form = FormStack();
        form.Controls.Add(SectionTitle("Protéger mon mot de passe téléphonique", "Il reste sur ce PC, protégé par Windows pour votre session. Il n’est jamais envoyé au CRM."));
        form.Controls.Add(Labeled("Mot de passe téléphonique", sipPassword));
        form.Controls.Add(InfoBox("Protection locale", "Votre mot de passe n’apparaît ni dans les journaux, ni dans les diagnostics exportés."));
        var button = ActionButton("Enregistrer et continuer", true); button.Click += async (_, _) => await ConfigureSecretAsync(); form.Controls.Add(button);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildAudioStep(bool wizard)
    {
        inputDevices = DeviceCombo(); inputDevices.AccessibleName = "Microphone";
        outputDevices = DeviceCombo(); outputDevices.AccessibleName = "Casque ou haut-parleur";
        microphoneLevel = new ProgressBar { Minimum = 0, Maximum = 100, Width = 520, Height = 20, AccessibleName = "Niveau du microphone" };
        microphoneLevelText = new Label { AutoSize = true, ForeColor = Muted, Margin = new Padding(0, 4, 0, 0), Text = "Lancez le test puis parlez normalement." };
        var form = FormStack();
        form.Controls.Add(SectionTitle("Choisir et tester mes périphériques", "Les tests sont locaux : aucun appel n’est lancé et aucun son n’est enregistré."));
        form.Controls.Add(Labeled("Microphone", inputDevices));
        form.Controls.Add(Labeled("Casque ou haut-parleur", outputDevices));
        form.Controls.Add(Labeled("Niveau du microphone", microphoneLevel));
        form.Controls.Add(microphoneLevelText);
        localMonitoring = new CheckBox {
            AutoSize = true,
            Checked = false,
            Text = "Écouter ma voix pendant le test (optionnel)",
            AccessibleName = "Activer l’écoute locale du microphone",
            ForeColor = Navy,
            Margin = new Padding(0, 8, 0, 2),
        };
        form.Controls.Add(localMonitoring);
        form.Controls.Add(new Label {
            AutoSize = true,
            ForeColor = Muted,
            MaximumSize = new Size(720, 0),
            Text = "Désactivée par défaut. Cette écoute locale peut produire un retour ou une latence ; elle ne mesure pas la qualité d’un appel.",
        });
        var testRow = ButtonRow();
        var refresh = ActionButton("Actualiser", false); refresh.Click += (_, _) => RefreshDevices();
        microphoneTestButton = ActionButton("Tester le microphone", false); microphoneTestButton.Click += (_, _) => ToggleMicrophoneTest();
        var outputTest = ActionButton("Tester la sortie", false); outputTest.Click += (_, _) => PlayOutputTest();
        testRow.Controls.Add(refresh); testRow.Controls.Add(microphoneTestButton); testRow.Controls.Add(outputTest); form.Controls.Add(testRow);
        var apply = ActionButton(wizard ? "Enregistrer et continuer" : "Enregistrer les périphériques", true);
        apply.Click += (_, _) => SaveDevices(wizard); form.Controls.Add(apply);
        form.Controls.Add(InfoBox("Pendant un appel", "Un casque retiré n’est jamais remplacé silencieusement par les haut-parleurs. L’appel est interrompu et le problème est signalé."));
        form.Controls.Add(feedback);
        FillDeviceCombos();
        return form;
    }

    private Control BuildAvailabilityStep()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Vérifier la disponibilité", "La configuration est enregistrée. La disponibilité réelle exige le CRM, l’autorisation du poste, le SIP et les deux périphériques."));
        var status = BuildFourStatusCards(); form.Controls.Add(status);
        readinessLabel = new Label { AutoSize = true, MaximumSize = new Size(720, 0), Font = new Font("Segoe UI", 12, FontStyle.Bold), Margin = new Padding(0, 16, 0, 10) };
        form.Controls.Add(readinessLabel);
        var actions = ButtonRow();
        connectButton = ActionButton("Connecter le poste", true); connectButton.Click += async (_, _) => await ConnectAsync();
        disconnectButton = ActionButton("Déconnecter", false); disconnectButton.Click += async (_, _) => await DisconnectAsync();
        finishButton = ActionButton("Ouvrir le tableau de bord", true); finishButton.Click += (_, _) => { wizardVisible = false; Render(); };
        actions.Controls.Add(connectButton); actions.Controls.Add(disconnectButton); actions.Controls.Add(finishButton); form.Controls.Add(actions);
        form.Controls.Add(feedback);
        return form;
    }

    private Control BuildDashboard()
    {
        var root = Page();
        root.Controls.Add(BuildBrandHeader("Mon poste téléphonique", "Profil enregistré, disponibilité en temps réel et appels sortants tracés."));

        var availability = Card(); availability.Padding = new Padding(20); availability.Margin = new Padding(0, 0, 0, 14);
        var stack = FormStack();
        readinessLabel = new Label { AutoSize = true, Font = new Font("Segoe UI", 15, FontStyle.Bold), Margin = new Padding(0, 0, 0, 12) };
        stack.Controls.Add(readinessLabel); stack.Controls.Add(BuildFourStatusCards()); availability.Controls.Add(stack); root.Controls.Add(availability);

        var profile = Card(); profile.Padding = new Padding(20); profile.Margin = new Padding(0, 0, 0, 14);
        var profileStack = FormStack(); profileStack.Controls.Add(SectionTitle("Profil enregistré", "Cette configuration reste disponible après fermeture et réouverture de l’agent."));
        var settings = setup.Settings;
        accountDisplayValue = SummaryValue(AccountLabel(settings));
        profileStack.Controls.Add(SummaryRow("Compte CRM", accountDisplayValue));
        profileStack.Controls.Add(SummaryRow("Poste associé", settings?.WorkstationDisplayName ?? Environment.MachineName));
        profileStack.Controls.Add(SummaryRow("Profil téléphonique", settings is null ? "Non configuré" : MaskSip(settings.SipAddress)));
        profileStack.Controls.Add(SummaryRow("Microphone", DeviceLabel(snapshot.InputDeviceId, true)));
        profileStack.Controls.Add(SummaryRow("Sortie", DeviceLabel(snapshot.OutputDeviceId, false)));
        var profileActions = ButtonRow();
        var modify = ActionButton("Modifier", false); modify.Click += async (_, _) => { wizardVisible = true; wizardStep = 3; Render(); await EnsureAudioForViewAsync(); };
        var reassociate = ActionButton("Réassocier", false); reassociate.Click += async (_, _) => { await runtime.StopAsync(); wizardVisible = true; wizardStep = 0; Render(); };
        connectButton = ActionButton("Connecter", true); connectButton.Click += async (_, _) => await ConnectAsync();
        disconnectButton = ActionButton("Déconnecter", false); disconnectButton.Click += async (_, _) => await DisconnectAsync();
        var quit = ActionButton("Quitter", false); quit.Click += async (_, _) => { allowClose = true; await runtime.StopAsync(); tray.Visible = false; Close(); };
        profileActions.Controls.Add(modify); profileActions.Controls.Add(reassociate); profileActions.Controls.Add(connectButton); profileActions.Controls.Add(disconnectButton); profileActions.Controls.Add(quit);
        profileStack.Controls.Add(profileActions); profileStack.Controls.Add(feedback); profile.Controls.Add(profileStack); root.Controls.Add(profile);

        root.Controls.Add(BuildCallCard());
        var tabs = new TabControl { Dock = DockStyle.Top, Height = 420, Padding = new Point(14, 7), Margin = new Padding(0, 0, 0, 16) };
        tabs.TabPages.Add(Tab("Audio", BuildAudioStep(false)));
        tabs.TabPages.Add(Tab("Diagnostic", BuildDiagnosticPage()));
        root.Controls.Add(tabs);
        return root;
    }

    private Control BuildFourStatusCards()
    {
        var grid = new TableLayoutPanel { Dock = DockStyle.Top, AutoSize = true, ColumnCount = 4, Margin = new Padding(0) };
        for (var index = 0; index < 4; index++) grid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 25));
        crmStatus = StatusValue(); authorizationStatus = StatusValue(); sipStatus = StatusValue(); audioStatus = StatusValue();
        grid.Controls.Add(StatusCard("CRM", crmStatus), 0, 0);
        grid.Controls.Add(StatusCard("POSTE", authorizationStatus), 1, 0);
        grid.Controls.Add(StatusCard("SIP", sipStatus), 2, 0);
        grid.Controls.Add(StatusCard("AUDIO", audioStatus), 3, 0);
        return grid;
    }

    private Control BuildCallCard()
    {
        var panel = Card(); panel.Padding = new Padding(18); panel.Margin = new Padding(0, 0, 0, 14);
        var row = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, ColumnCount = 3 };
        row.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize)); row.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        var text = FormStack(); text.Controls.Add(new Label { AutoSize = true, Text = "APPEL COURANT", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal });
        callValue = new Label { AutoSize = true, Font = new Font("Segoe UI", 11, FontStyle.Bold), ForeColor = Navy };
        durationValue = new Label { AutoSize = true, ForeColor = Muted }; text.Controls.Add(callValue); text.Controls.Add(durationValue);
        var mute = ActionButton("Couper le micro", false); mute.Name = "mute"; mute.Click += (_, _) => runtime.SetMuted(!snapshot.Muted);
        var hangup = ActionButton("Raccrocher", false); hangup.Name = "hangup"; hangup.Click += (_, _) => runtime.Hangup();
        row.Controls.Add(text, 0, 0); row.Controls.Add(mute, 1, 0); row.Controls.Add(hangup, 2, 0); panel.Controls.Add(row); return panel;
    }

    private Control BuildDiagnosticPage()
    {
        var form = FormStack();
        form.Controls.Add(SectionTitle("Diagnostic expurgé", "L’export exclut secrets, jetons, numéros, identités SIP et noms de périphériques."));
        var export = ActionButton("Exporter le diagnostic", false); export.Click += (_, _) => ExportDiagnostic(); form.Controls.Add(export);
        var autoStart = new CheckBox { AutoSize = true, Text = "Démarrer automatiquement avec ma session Windows", Checked = StartupManager.Enabled, Margin = new Padding(0, 12, 0, 0) };
        autoStart.CheckedChanged += (_, _) => { try { StartupManager.Enabled = autoStart.Checked; } catch { autoStart.Checked = StartupManager.Enabled; ShowFeedback("Le démarrage automatique n’a pas pu être modifié.", true); } };
        form.Controls.Add(autoStart);
        form.Controls.Add(InfoBox("Confidentialité", "Réception et enregistrement audio restent désactivés. Les détails techniques sont réservés au diagnostic expurgé."));
        return form;
    }

    private async Task PairAsync()
    {
        if (pairingCode is null || workstationName is null || string.IsNullOrWhiteSpace(pairingCode.Text) || string.IsNullOrWhiteSpace(workstationName.Text)) { ShowFeedback("Renseignez le code d’association et le nom du poste.", true); return; }
        try
        {
            await runtime.StopAsync();
            var api = setup.Settings?.ApiBaseUrl ?? AgentSetup.ConfiguredApiBaseUrl;
            await setup.PairAsync(api, pairingCode.Text, workstationName.Text, CancellationToken.None);
            pairingCode.Clear(); wizardStep = 1; ShowFeedback("Poste associé. Vérifiez maintenant le profil attribué.", false); Render();
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private async Task ConfigureSecretAsync()
    {
        try
        {
            if (sipPassword is null) return;
            setup.ConfigureSecret(sipPassword.Text); sipPassword.Clear();
            await runtime.ResetAudioAsync(); wizardStep = 3;
            ShowFeedback("Mot de passe téléphonique protégé par Windows sur ce poste.", false); Render();
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private async Task EnsureAudioForViewAsync()
    {
        try { await runtime.EnsureAudioAsync(); FillDeviceCombos(); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void SaveDevices(bool continueWizard)
    {
        try
        {
            var input = inputDevices?.SelectedItem as AudioDeviceItem;
            var output = outputDevices?.SelectedItem as AudioDeviceItem;
            if (input is null || output is null) throw new InvalidOperationException("AUDIO_DEVICE_UNAVAILABLE");
            runtime.ApplyDevices(input.Id, output.Id);
            ShowFeedback("Périphériques enregistrés pour ce poste.", false);
            if (continueWizard) { runtime.StopMicrophoneTest(); wizardStep = 4; Render(); }
            else Render();
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void RefreshDevices()
    {
        try { runtime.RefreshAudioDevices(); FillDeviceCombos(); ShowFeedback("Liste des périphériques actualisée.", false); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void ToggleMicrophoneTest()
    {
        try
        {
            if (snapshot.AudioTestActive) { runtime.StopMicrophoneTest(); ShowFeedback("Test microphone arrêté. Aucun son n’a été enregistré.", false); }
            else {
                ApplySelectedDevicesWithoutSaving();
                var listenLocally = localMonitoring?.Checked == true;
                runtime.StartMicrophoneTest(listenLocally);
                ShowFeedback(listenLocally
                    ? "Parlez normalement : la jauge doit réagir. L’écoute locale optionnelle est active ; aucun appel ni enregistrement n’est produit."
                    : "Parlez normalement : la jauge et le pourcentage doivent réagir. Aucun retour de voix, appel ou enregistrement n’est produit.", false);
            }
        }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void PlayOutputTest()
    {
        try { ApplySelectedDevicesWithoutSaving(); runtime.PlayOutputTest(); ShowFeedback("Son de test envoyé uniquement vers la sortie sélectionnée.", false); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void ApplySelectedDevicesWithoutSaving()
    {
        var input = inputDevices?.SelectedItem as AudioDeviceItem;
        var output = outputDevices?.SelectedItem as AudioDeviceItem;
        if (input is null || output is null) throw new InvalidOperationException("AUDIO_DEVICE_UNAVAILABLE");
        runtime.ApplyDevices(input.Id, output.Id);
    }

    private async Task ConnectAsync()
    {
        try { await runtime.StartAsync(); ShowFeedback("Connexion en cours. Le poste sera prêt lorsque les quatre contrôles seront confirmés.", false); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private async Task DisconnectAsync()
    {
        try { await runtime.StopAsync(); await runtime.EnsureAudioAsync(); ShowFeedback("Poste déconnecté. La configuration reste enregistrée.", false); }
        catch (Exception error) { ShowFeedback(HumanError(error), true); }
    }

    private void FillDeviceCombos()
    {
        if (inputDevices is null || outputDevices is null) return;
        FillDevices(inputDevices, snapshot.Devices.Where(item => item.CanRecord), snapshot.InputDeviceId);
        FillDevices(outputDevices, snapshot.Devices.Where(item => item.CanPlay), snapshot.OutputDeviceId);
        if (inputDevices.Items.Count == 0 || outputDevices.Items.Count == 0) ShowFeedback("Aucun périphérique utilisable n’est disponible. Vérifiez le branchement et l’autorisation microphone de Windows.", true);
    }

    private void OnSnapshotChanged(AgentRuntimeSnapshot next)
    {
        if (InvokeRequired) { BeginInvoke(() => OnSnapshotChanged(next)); return; }
        snapshot = next;
        UpdateVisibleState();
    }

    private void UpdateVisibleState()
    {
        if (IsDisposed) return;
        if (crmStatus is not null) crmStatus.Text = snapshot.CrmConnected ? "Connecté" : snapshot.Running ? "Injoignable" : "Déconnecté";
        if (authorizationStatus is not null) authorizationStatus.Text = snapshot.AuthorizationState;
        if (sipStatus is not null) sipStatus.Text = snapshot.SipRegistered ? "Connecté" : snapshot.Running ? "Connexion en cours" : "Déconnecté";
        if (audioStatus is not null) audioStatus.Text = snapshot.InputDeviceAvailable && snapshot.OutputDeviceAvailable ? "Utilisable" : snapshot.AudioInitialized ? "À vérifier" : "Non chargé";
        var ready = AgentReadiness.IsReady(snapshot);
        if (readinessLabel is not null) { readinessLabel.Text = ready ? "Prêt à appeler" : ReadinessExplanation(snapshot); readinessLabel.ForeColor = ready ? Success : Danger; }
        if (finishButton is not null) finishButton.Enabled = ready;
        if (connectButton is not null) connectButton.Enabled = !snapshot.Running;
        if (disconnectButton is not null) disconnectButton.Enabled = snapshot.Running;
        var displayedMicrophoneLevel = snapshot.AudioTestActive ? snapshot.MicrophoneLevel : snapshot.LastMicrophonePeak;
        if (microphoneLevel is not null) microphoneLevel.Value = Math.Clamp(displayedMicrophoneLevel, 0, 100);
        if (microphoneLevelText is not null) microphoneLevelText.Text = snapshot.AudioMeterErrorCode is not null
            ? "Mesure interrompue · actualisez les périphériques puis réessayez."
            : snapshot.AudioTestActive
                ? snapshot.MicrophoneLevel > 0 ? $"Signal détecté · {snapshot.MicrophoneLevel}%" : "Microphone ouvert · parlez normalement…"
                : snapshot.LastMicrophonePeak > 0 ? $"Pic du dernier test · {snapshot.LastMicrophonePeak}%" : "Lancez le test puis parlez normalement.";
        if (microphoneTestButton is not null) microphoneTestButton.Text = snapshot.AudioTestActive ? "Arrêter le test microphone" : "Tester le microphone";
        if (callValue is not null) callValue.Text = CallLabel(snapshot.CallState);
        if (durationValue is not null) durationValue.Text = snapshot.CallDurationSeconds is int seconds ? $"Durée observée : {seconds / 60:00}:{seconds % 60:00}" : "Aucun appel actif";
        if (accountDisplayValue is not null) accountDisplayValue.Text = !string.IsNullOrWhiteSpace(snapshot.CrmDisplayName) ? snapshot.CrmDisplayName! : !string.IsNullOrWhiteSpace(snapshot.CrmEmail) ? snapshot.CrmEmail! : AccountLabel(setup.Settings);
        var mute = FindControl("mute") as Button; var hangup = FindControl("hangup") as Button;
        if (mute is not null) { mute.Text = snapshot.Muted ? "Rétablir le micro" : "Couper le micro"; mute.Enabled = snapshot.CallState == "ANSWERED"; }
        if (hangup is not null) hangup.Enabled = snapshot.CallState is "DIALING" or "RINGING" or "ANSWERED" or "REQUESTED";
        if (inputDevices is not null && outputDevices is not null && inputDevices.Items.Count == 0 && snapshot.Devices.Count > 0) FillDeviceCombos();
    }

    private Control? FindControl(string name)
    {
        var controls = contentHost.Controls.Find(name, true);
        return controls.FirstOrDefault();
    }

    private void ExportDiagnostic()
    {
        using var dialog = new SaveFileDialog { Filter = "Diagnostic JSON (*.json)|*.json", FileName = $"crm-ynov-telephonie-{DateTime.Now:yyyyMMdd-HHmmss}.json", AddExtension = true, DefaultExt = "json" };
        if (dialog.ShowDialog(this) != DialogResult.OK) return;
        var settings = store.Load(); DiagnosticsExporter.Export(dialog.FileName, snapshot, settings is not null, settings?.SipPassword.Length > 0);
        ShowFeedback("Diagnostic expurgé exporté.", false);
    }

    private async void OnFormClosing(object? sender, FormClosingEventArgs eventArgs)
    {
        if (!allowClose && eventArgs.CloseReason == CloseReason.UserClosing) { eventArgs.Cancel = true; Hide(); tray.ShowBalloonTip(1500, "CRM Ynov", "L’agent reste accessible dans la zone de notification.", ToolTipIcon.Info); return; }
        audioTimer.Stop(); tray.Visible = false; await runtime.DisposeAsync();
    }

    private ContextMenuStrip BuildTrayMenu()
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Ouvrir", null, (_, _) => RestoreWindow());
        menu.Items.Add("Connecter", null, async (_, _) => await ConnectAsync());
        menu.Items.Add("Déconnecter", null, async (_, _) => await DisconnectAsync());
        menu.Items.Add("Quitter", null, async (_, _) => { allowClose = true; await runtime.StopAsync(); tray.Visible = false; Close(); });
        return menu;
    }

    private void RestoreWindow() { Show(); WindowState = FormWindowState.Normal; Activate(); }
    private void ShowFeedback(string message, bool error) { feedback.Text = message; feedback.ForeColor = error ? Danger : Success; }

    private static string HumanError(Exception error) => error switch {
        HttpRequestException { StatusCode: HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden } => "Le code ou l’autorisation du poste a été refusé. Demandez un nouveau code à l’administration.",
        HttpRequestException { StatusCode: HttpStatusCode.Conflict } => "Ce profil est déjà associé à un autre poste actif. L’administration doit d’abord vérifier cette association.",
        HttpRequestException http when http.StatusCode is not null => "Le CRM a refusé la demande. Vérifiez les informations saisies avant de recommencer.",
        HttpRequestException => "Le CRM est momentanément injoignable. La configuration locale est conservée.",
        InvalidOperationException invalid when invalid.Message == "AGENT_NOT_PAIRED" => "Associez d’abord ce poste au CRM.",
        InvalidOperationException invalid when invalid.Message == "SIP_SECRET_MISSING" => "Enregistrez d’abord le mot de passe téléphonique sur ce poste.",
        InvalidOperationException invalid when invalid.Message == "SIP_SECRET_EMPTY" => "Le mot de passe téléphonique ne peut pas être vide.",
        InvalidOperationException invalid when invalid.Message is "AUDIO_DEVICE_UNAVAILABLE" or "AUDIO_INPUT_UNAVAILABLE" or "AUDIO_OUTPUT_UNAVAILABLE" => "Le périphérique sélectionné n’est plus disponible. Actualisez la liste et choisissez un périphérique connecté.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_NOT_INITIALIZED" => "Le service audio local n’est pas encore disponible. Rouvrez l’étape Audio.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_TEST_CALL_ACTIVE" => "Terminez l’appel en cours avant de lancer un test audio local.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_TEST_ACTIVE" => "Arrêtez le test microphone avant de lancer un appel ou un autre test audio.",
        InvalidOperationException invalid when invalid.Message.StartsWith("AUDIO_LOCAL_MONITORING", StringComparison.Ordinal) => "L’écoute locale n’a pas pu être activée. Décochez-la pour tester uniquement la jauge, sans retour de voix.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_MICROPHONE_OPEN_FAILED" => "Le microphone n’a pas pu être ouvert. Vérifiez qu’il est connecté et que Windows autorise l’accès au microphone.",
        InvalidOperationException invalid when invalid.Message == "AUDIO_CAPTURE_RESTART_REQUIRED" => "Windows n’a pas libéré le microphone en toute sécurité. Quittez puis relancez l’agent avant un nouvel essai ou appel.",
        InvalidOperationException invalid when invalid.Message.StartsWith("AUDIO_CAPTURE_", StringComparison.Ordinal) => "Le niveau du microphone ne peut pas être mesuré sur ce périphérique. Actualisez la liste, sélectionnez explicitement le micro puis réessayez.",
        InvalidOperationException invalid when invalid.Message is "AUDIO_PLAYER_UNAVAILABLE" or "AUDIO_TEST_FILE_MISSING" => "Le son de test n’a pas pu être envoyé vers la sortie choisie. Actualisez les périphériques puis réessayez.",
        _ => "L’opération n’a pas pu être confirmée. Aucun appel n’a été lancé.",
    };

    private static string ReadinessExplanation(AgentRuntimeSnapshot state)
    {
        if (!state.InputDeviceAvailable || !state.OutputDeviceAvailable) return "Périphériques audio à vérifier";
        if (!state.Running) return "Configuration enregistrée · poste déconnecté";
        if (!state.CrmConnected) return "Connexion CRM à confirmer";
        if (state.AuthorizationState != "Autorisée") return "Autorisation du poste à confirmer";
        if (!state.SipRegistered) return "Connexion téléphonique à confirmer";
        return "Disponibilité à confirmer";
    }

    private static string AccountLabel(AgentSettings? settings)
    {
        if (!string.IsNullOrWhiteSpace(settings?.CrmDisplayName)) return settings.CrmDisplayName!;
        if (!string.IsNullOrWhiteSpace(settings?.CrmEmail)) return settings.CrmEmail!;
        return settings is null ? "Non associé" : "Compte CRM associé";
    }

    private string DeviceLabel(string? id, bool input)
    {
        if (string.IsNullOrWhiteSpace(id)) return "Non sélectionné";
        return snapshot.Devices.FirstOrDefault(item => item.Id == id && (input ? item.CanRecord : item.CanPlay))?.Name ?? "Périphérique actuellement déconnecté";
    }

    private static string CallLabel(string? state) => state switch { "DIALING" => "Numérotation demandée", "RINGING" => "Le poste distant sonne", "ANSWERED" => "Communication établie", "ENDED" => "Appel terminé", "FAILED" => "Échec de l’appel", "MISSED" => "Sans réponse", "CANCELLED" => "Appel annulé", _ => "Aucun appel en cours" };
    private static string MaskSip(string value) { var at = value.IndexOf('@'); var user = value.StartsWith("sip:", StringComparison.OrdinalIgnoreCase) ? value[4..Math.Max(4, at)] : "Extension"; return at < 0 ? "Extension configurée" : $"{user} · {value[(at + 1)..]}"; }

    private static FlowLayoutPanel Page() => new() { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(28), BackColor = Surface };
    private static Panel Card() => new() { Dock = DockStyle.Top, AutoSize = true, BackColor = Color.White, BorderStyle = BorderStyle.FixedSingle, MinimumSize = new Size(700, 0) };
    private static Label StatusValue() => new() { AutoSize = true, Font = new Font("Segoe UI", 10, FontStyle.Bold), ForeColor = Navy };
    private static Control BuildBrandHeader(string title, string subtitle)
    {
        var panel = new FlowLayoutPanel { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Margin = new Padding(0, 0, 0, 20) };
        panel.Controls.Add(new Label { AutoSize = true, Text = "RELATION YNOV", Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal });
        panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 23, FontStyle.Bold), ForeColor = Navy });
        panel.Controls.Add(new Label { AutoSize = true, Text = subtitle, ForeColor = Muted, MaximumSize = new Size(800, 0) });
        return panel;
    }
    private static Control StatusCard(string label, Control value) { var panel = Card(); panel.Padding = new Padding(14); panel.Margin = new Padding(0, 0, 8, 0); panel.MinimumSize = Size.Empty; var stack = FormStack(); stack.Controls.Add(new Label { AutoSize = true, Text = label, Font = new Font("Segoe UI", 8, FontStyle.Bold), ForeColor = Teal }); stack.Controls.Add(value); panel.Controls.Add(stack); return panel; }
    private static TabPage Tab(string title, Control content) { var page = new TabPage(title) { BackColor = Surface, Padding = new Padding(18), AutoScroll = true }; page.Controls.Add(content); return page; }
    private static FlowLayoutPanel FormStack() => new() { Dock = DockStyle.Top, AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, Padding = new Padding(2) };
    private static FlowLayoutPanel ButtonRow() => new() { AutoSize = true, FlowDirection = FlowDirection.LeftToRight, WrapContents = true, Margin = new Padding(0, 10, 0, 0) };
    private static Control SectionTitle(string title, string description) { var panel = FormStack(); panel.Margin = new Padding(0, 0, 0, 16); panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 15, FontStyle.Bold), ForeColor = Navy }); panel.Controls.Add(new Label { AutoSize = true, MaximumSize = new Size(720, 0), Text = description, ForeColor = Muted }); return panel; }
    private static Control Labeled(string label, Control control) { control.Width = 520; var panel = FormStack(); panel.Margin = new Padding(0, 0, 0, 12); panel.Controls.Add(new Label { AutoSize = true, Text = label, Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = Navy }); panel.Controls.Add(control); return panel; }
    private static Control SummaryRow(string label, string value) { var panel = new TableLayoutPanel { AutoSize = true, Width = 690, ColumnCount = 2, Margin = new Padding(0, 0, 0, 8) }; panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200)); panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); panel.Controls.Add(new Label { AutoSize = true, Text = label, ForeColor = Muted }, 0, 0); panel.Controls.Add(new Label { AutoSize = true, Text = value, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), ForeColor = Navy, MaximumSize = new Size(470, 0) }, 1, 0); return panel; }
    private static Control SummaryRow(string label, Control value) { var panel = new TableLayoutPanel { AutoSize = true, Width = 690, ColumnCount = 2, Margin = new Padding(0, 0, 0, 8) }; panel.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 200)); panel.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100)); panel.Controls.Add(new Label { AutoSize = true, Text = label, ForeColor = Muted }, 0, 0); panel.Controls.Add(value, 1, 0); return panel; }
    private static Label SummaryValue(string value) => new() { AutoSize = true, Text = value, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), ForeColor = Navy, MaximumSize = new Size(470, 0) };
    private static Control InfoBox(string title, string value) { var panel = new FlowLayoutPanel { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false, BackColor = Color.FromArgb(232, 248, 246), Padding = new Padding(14), Margin = new Padding(0, 0, 0, 14), MaximumSize = new Size(720, 0) }; panel.Controls.Add(new Label { AutoSize = true, Text = title, Font = new Font("Segoe UI", 9, FontStyle.Bold), ForeColor = Success }); panel.Controls.Add(new Label { AutoSize = true, Text = value, ForeColor = Navy, MaximumSize = new Size(680, 0) }); return panel; }
    private static TextBox Field(string value) => new() { Text = value, Width = 520, BorderStyle = BorderStyle.FixedSingle };
    private static ComboBox DeviceCombo() => new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 520 };
    private static Button ActionButton(string text, bool primary) { var button = new Button { AutoSize = true, Text = text, FlatStyle = FlatStyle.Flat, Padding = new Padding(13, 7, 13, 7), Margin = new Padding(0, 0, 8, 0), BackColor = primary ? Teal : Color.White, ForeColor = primary ? Navy : Navy, Font = new Font("Segoe UI", 9.5f, FontStyle.Bold), UseVisualStyleBackColor = false }; button.FlatAppearance.BorderColor = primary ? Teal : Color.FromArgb(188, 202, 213); return button; }
    private static void FillDevices(ComboBox combo, IEnumerable<AudioDeviceView> devices, string? selectedId) { combo.Items.Clear(); foreach (var item in devices) combo.Items.Add(new AudioDeviceItem(item.Id, item.Name)); var selected = combo.Items.Cast<AudioDeviceItem>().FirstOrDefault(item => item.Id == selectedId); combo.SelectedItem = selected ?? (combo.Items.Count > 0 ? combo.Items[0] : null); }
    private sealed record AudioDeviceItem(string Id, string Label) { public override string ToString() => Label; }
}
