using System.Collections.Concurrent;
using System.Reflection;
using System.Runtime.CompilerServices;
using CrmYnov.TelephonyAgent;

internal static class DesktopRecoveryTests
{
    private static int checks;
    private static void Check(bool value) { checks++; if (!value) throw new InvalidOperationException("RECOVERY_ASSERT_"+checks); }
    [STAThread]
    private static void Main(string[] args)
    {
        SdkShutdownSelfTest.Run();
        var gate = new AgentUiOperationGate();
        Check(!gate.IsBusy);
        using(var first=gate.TryBegin()) {
            Check(first is not null && gate.IsBusy); Check(gate.TryBegin() is null);
            first!.Dispose(); first.Dispose(); Check(!gate.IsBusy);
            using var second=gate.TryBegin(); Check(second is not null && gate.IsBusy);
        }
        Check(!gate.IsBusy);
        try { using var failing=gate.TryBegin(); throw new IOException("SYNTHETIC"); } catch(IOException) { Check(!gate.IsBusy); }
        var context = new OwningContext(); context.Run(ShutdownTestsAsync);
        if(args.Length==2) LayoutTests(args[0],args[1]);
        Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new { passed=true,checks,nativeSdkLoaded=false,networkUsed=false,realProfileUsed=false,installerTested=false,scope="managed shutdown/gate + offscreen actual layout components only" }));
    }
    private static async Task ShutdownTestsAsync()
    {
        await ExplicitLocalAudioTestsAsync();
        var uiGate = new AgentUiOperationGate(); var attempts = 0;
        async Task SubmittedOperation(bool fail) {
            using var lease=uiGate.TryBegin(); if(lease is null)return;
            attempts++; await Task.Yield(); Check(uiGate.IsBusy);
            if(fail)throw new IOException("SYNTHETIC_ASSOCIATION_RESPONSE_LOST");
        }
        var first=SubmittedOperation(false); await SubmittedOperation(false); await first;
        Check(attempts==1 && !uiGate.IsBusy);
        try { await SubmittedOperation(true); } catch(IOException) { Check(!uiGate.IsBusy); }
        Check(attempts==2); // No automatic replay after a failed/unknown response.
        var owner=Environment.CurrentManagedThreadId;
        var on=new SdkShutdownObservation(ObservedSdkState.On,true,false,false,false);
        var off=on with {State=ObservedSdkState.Off,RegistrationCleared=true};
        async Task Test(SdkShutdownObservation[] values,string? refusal=null,bool brokenClock=false,bool backwards=false,bool stopFails=false) {
            var control=new FakeControl(values,owner,stopFails); var time=TimeSpan.Zero;
            try {
                var receipt=await SdkShutdownCoordinator.StopAsync(control,()=>time,async()=>{
                    await Task.Yield(); Check(Environment.CurrentManagedThreadId==owner);
                    if(!brokenClock)time+=TimeSpan.FromMilliseconds(backwards?-20:20);
                },TimeSpan.FromMilliseconds(60));
                Check(refusal is null && receipt.CoreOffObserved);
            } catch(InvalidOperationException e) when(e.Message==refusal) { Check(true); }
              catch(IOException) when(stopFails) { Check(true); }
            Check(!control.AfterOff && control.StopCount<=1);
        }
        await Test([on,on,off]); await Test([off]);
        await Test([on,off with{RegistrationCleared=false}],"SDK_UNREGISTER_UNPROVEN");
        await Test([on],"SDK_SHUTDOWN_TIMEOUT");
        await Test([on],"SDK_SHUTDOWN_TIMEOUT",brokenClock:true);
        await Test([on],"SDK_SHUTDOWN_TIMEOUT",backwards:true);
        await Test([on,on with{HasAccount=false}],"SDK_SHUTDOWN_ACCOUNT_CHANGED");
        await Test([on with{HasCalls=true}],"PROFILE_MAINTENANCE_CALL_ACTIVE");
        await Test([on,on with{AudioActive=true}],"PROFILE_MAINTENANCE_AUDIO_ACTIVE");
        await Test([on with{State=ObservedSdkState.Ready}],"SDK_SHUTDOWN_STATE_UNPROVEN");
        await Test([on],stopFails:true);
        foreach(var deadline in new[]{TimeSpan.Zero,TimeSpan.FromSeconds(-1),TimeSpan.FromSeconds(31)}) {
            try { await SdkShutdownCoordinator.StopAsync(new FakeControl([on],owner),()=>TimeSpan.Zero,()=>Task.CompletedTask,deadline);Check(false); }
            catch(InvalidOperationException e) when(e.Message=="SDK_SHUTDOWN_DEADLINE_INVALID") { Check(true); }
        }
        var clockReads=0;
        try { await SdkShutdownCoordinator.StopAsync(new FakeControl([on,off],owner),()=>clockReads++==0?TimeSpan.Zero:TimeSpan.FromSeconds(1),()=>Task.CompletedTask,TimeSpan.FromSeconds(1));Check(false); }
        catch(InvalidOperationException e) when(e.Message=="SDK_SHUTDOWN_TIMEOUT") { Check(true); }
    }
    private static async Task ExplicitLocalAudioTestsAsync()
    {
        var owner = Environment.CurrentManagedThreadId;
        var events = new List<string>();
        // Same production coordinator; synthetic callbacks only. No SDK/profile.
        await AgentLocalAudioAction.RunAsync(async () => {
            events.Add("ensure"); await Task.Yield();
            Check(Environment.CurrentManagedThreadId == owner);
            events.Add("audio-ready");
        }, () => { Check(Environment.CurrentManagedThreadId == owner); events.Add("explicit-local-action"); });
        Check(string.Join(",", events) == "ensure,audio-ready,explicit-local-action");
        var actions = 0; var initializations = 0;
        try {
            await AgentLocalAudioAction.RunAsync(() => {
                initializations++; throw new InvalidOperationException("SYNTHETIC_AUDIO_INIT_FAILED");
            }, () => actions++);
            Check(false);
        } catch (InvalidOperationException e) when (e.Message == "SYNTHETIC_AUDIO_INIT_FAILED") { Check(actions == 0 && initializations == 1); }
        try {
            await AgentLocalAudioAction.RunAsync(() => { initializations++; return Task.CompletedTask; }, () => {
                actions++; throw new InvalidOperationException("SYNTHETIC_DEVICE_REMOVED");
            });
            Check(false);
        } catch (InvalidOperationException e) when (e.Message == "SYNTHETIC_DEVICE_REMOVED") { Check(actions == 1 && initializations == 2); }
        // Merely constructing a delegate/disconnecting does not initialize audio.
        Func<Task> explicitAction = () => AgentLocalAudioAction.RunAsync(() => { initializations++; return Task.CompletedTask; }, () => actions++);
        Check(initializations == 2 && actions == 1);
        await explicitAction(); Check(initializations == 3 && actions == 2);
        var closing = false;
        await AgentLocalAudioAction.RunAsync(async () => { await Task.Yield(); closing = true; }, () => { if (!closing) actions++; });
        Check(actions == 2);
    }
    private sealed class FakeControl(SdkShutdownObservation[] values,int owner,bool fail=false):ISdkShutdownControl {
        private int index; private bool off; public bool AfterOff;public int StopCount;
        public SdkShutdownObservation Observe(){Check(Environment.CurrentManagedThreadId==owner);var v=values[Math.Min(index++,values.Length-1)];off=v.State==ObservedSdkState.Off;return v;}
        public void BeginStopAsync(){Check(Environment.CurrentManagedThreadId==owner);StopCount++;if(fail)throw new IOException("SYNTHETIC");}
        public void Iterate(){Check(Environment.CurrentManagedThreadId==owner);AfterOff|=off;}
    }
    private sealed class OwningContext:SynchronizationContext {
        private readonly BlockingCollection<(SendOrPostCallback,object?)> queue=new();
        public override void Post(SendOrPostCallback callback,object? state)=>queue.Add((callback,state));
        public void Run(Func<Task> action){var previous=Current;SetSynchronizationContext(this);try{var task=action();while(!task.IsCompleted){var item=queue.Take();item.Item1(item.Item2);}task.GetAwaiter().GetResult();}finally{SetSynchronizationContext(previous);queue.Dispose();}}
    }
    private static void LayoutTests(string assemblyPath,string outputDirectory)
    {
        Directory.CreateDirectory(outputDirectory);
        var assembly=Assembly.LoadFrom(assemblyPath);var type=assembly.GetType("CrmYnov.TelephonyAgent.MainForm",true)!;
        var source=File.ReadAllText(Path.GetFullPath(Path.Combine(Path.GetDirectoryName(assemblyPath)!,"../../../MainForm.cs")));
        Check(source.Contains("closing = false; contentHost.Enabled = true; UseWaitCursor = false;",StringComparison.Ordinal));
        Check(source.Contains("setup.PairAsync(address, code, name, CancellationToken.None)",StringComparison.Ordinal));
        Check(source.Contains("await RunOperationAsync(\"Association en cours",StringComparison.Ordinal));
        Check(source.Contains("refresh.Click += async (_, _) => await RefreshDevicesAsync()", StringComparison.Ordinal));
        Check(source.Contains("await ToggleMicrophoneTestAsync()", StringComparison.Ordinal));
        Check(source.Contains("await PlayOutputTestAsync()", StringComparison.Ordinal));
        Check(source.Split("AgentLocalAudioAction.RunAsync(runtime.EnsureAudioAsync", StringSplitOptions.None).Length == 4);
        var disconnectSource = source.Substring(source.IndexOf("private async Task DisconnectAsync()", StringComparison.Ordinal));
        disconnectSource = disconnectSource.Substring(0, disconnectSource.IndexOf("private Task ReassociateAsync", StringComparison.Ordinal));
        Check(!disconnectSource.Contains("EnsureAudioAsync", StringComparison.Ordinal));
        Check(!disconnectSource.Contains("StartAsync", StringComparison.Ordinal));
        // Real production summary updater with source-bound synthetic snapshots;
        // do not construct MainForm, a profile store, broker, SDK or audio source.
        var summaryOwner=RuntimeHelpers.GetUninitializedObject(type);
        using var inputLabel=new Label();using var outputLabel=new Label();
        type.GetField("microphoneDisplayValue",BindingFlags.Instance|BindingFlags.NonPublic)!.SetValue(summaryOwner,inputLabel);
        type.GetField("outputDisplayValue",BindingFlags.Instance|BindingFlags.NonPublic)!.SetValue(summaryOwner,outputLabel);
        var snapshotType=assembly.GetType("CrmYnov.TelephonyAgent.AgentRuntimeSnapshot",true)!;
        var snapshotField=type.GetField("snapshot",BindingFlags.Instance|BindingFlags.NonPublic)!;
        var updater=type.GetMethod("UpdateDeviceSummary",BindingFlags.Instance|BindingFlags.NonPublic)!;
        void Snapshot(string ids,string devices) {
            var json="{\"Running\":false,\"CrmConnected\":false,\"SdkLoaded\":false,\"SipRegistered\":false,\"StatusCode\":\"SYNTHETIC\",\"Muted\":false,\"MicrophoneLevel\":0,"+ids+",\"Devices\":"+devices+"}";
            snapshotField.SetValue(summaryOwner,System.Text.Json.JsonSerializer.Deserialize(json,snapshotType));updater.Invoke(summaryOwner,null);
        }
        const string selected="\"InputDeviceId\":\"synthetic-in\",\"OutputDeviceId\":\"synthetic-out\"";
        Snapshot("\"InputDeviceId\":null,\"OutputDeviceId\":null","[]");
        Check(inputLabel.Text=="Non sélectionné"&&outputLabel.Text=="Non sélectionné");
        Snapshot(selected,"[{\"Id\":\"synthetic-in\",\"Name\":\"Micro de test\",\"CanRecord\":true,\"CanPlay\":false},{\"Id\":\"synthetic-out\",\"Name\":\"Sortie de test\",\"CanRecord\":false,\"CanPlay\":true}]");
        Check(inputLabel.Text=="Micro de test"&&outputLabel.Text=="Sortie de test");
        Snapshot(selected,"[]");Check(inputLabel.Text=="Périphérique actuellement déconnecté"&&outputLabel.Text=="Périphérique actuellement déconnecté");
        Snapshot(selected,"[{\"Id\":\"other\",\"Name\":\"Ne pas sélectionner\",\"CanRecord\":true,\"CanPlay\":true}]");
        Check(inputLabel.Text=="Périphérique actuellement déconnecté"&&outputLabel.Text=="Périphérique actuellement déconnecté");
        Snapshot(selected,"[{\"Id\":\"synthetic-in\",\"Name\":\"Pas un microphone\",\"CanRecord\":false,\"CanPlay\":true}]");
        Check(inputLabel.Text=="Périphérique actuellement déconnecté");
        object? Invoke(string name,params object?[] values)=>type.GetMethods(BindingFlags.Static|BindingFlags.NonPublic).Single(m=>m.Name==name&&m.GetParameters().Select(p=>p.ParameterType).SequenceEqual(values.Select(v=>v!.GetType()))).Invoke(null,values);
        object Static(string name)=>type.GetMethod(name,BindingFlags.Static|BindingFlags.NonPublic)!.Invoke(null,null)!;
        foreach(var code in new[]{"SDK_SHUTDOWN_TIMEOUT","SDK_UNREGISTER_UNPROVEN","SDK_SHUTDOWN_STATE_UNPROVEN"}) {
            var text=(string)type.GetMethod("HumanError",BindingFlags.Static|BindingFlags.NonPublic)!.Invoke(null,[new InvalidOperationException(code)])!;
            Check(text.Contains("Profil et journal conservés") && text.Contains("Aucune réassociation"));
        }
        foreach(var width in new[]{720,780,980,1280}) {
            using var host=new Panel{Width=width,Height=1150,Font=new Font("Segoe UI",9.5f),BackColor=Color.FromArgb(242,246,250)};
            var root=(Control)Static("Page");host.Controls.Add(root);
            root.Controls.Add((Control)Invoke("BuildBrandHeader","Mon poste téléphonique","Vue synthétique déconnectée · aucun compte réel, SDK ou appel")!);
            var availability=(Panel)Static("Card");var stack=(Control)Static("FormStack");availability.Controls.Add(stack);
            stack.Controls.Add(new Label{AutoSize=true,Text="Poste déconnecté · profil conservé",Font=new Font("Segoe UI",15,FontStyle.Bold)});
            // Invoke only the layout factory on an uninitialized owner: constructor,
            // broker, timers, tray, profile and runtime are never started.
            var owner=RuntimeHelpers.GetUninitializedObject(type);
            var grid=(Control)type.GetMethod("BuildFourStatusCards",BindingFlags.Instance|BindingFlags.NonPublic)!.Invoke(owner,null)!;
            stack.Controls.Add(grid);root.Controls.Add(availability);
            foreach(var field in new[]{"crmStatus","authorizationStatus","sipStatus","audioStatus"})
                ((Label)type.GetField(field,BindingFlags.Instance|BindingFlags.NonPublic)!.GetValue(owner)!).Text=field=="authorizationStatus"?"À vérifier":field=="audioStatus"?"Utilisable":"Déconnecté";
            var profile=(Panel)Static("Card");var form=(Control)Static("FormStack");profile.Controls.Add(form);
            form.Controls.Add((Control)Invoke("SectionTitle","Profil enregistré","Votre configuration reste disponible après fermeture de l’agent.")!);
            foreach(var pair in new[]{("Compte CRM","Compte synthétique"),("Environnement CRM","HTTPS · crm.example.test/agent"),("Poste associé","Poste de test"),("Microphone","Non sélectionné"),("Sortie","Non sélectionnée")})
                form.Controls.Add((Control)Invoke("SummaryRow",pair.Item1,pair.Item2)!);
            var actions=(Control)Static("ButtonRow");
            foreach(var label in new[]{"Modifier","Réassocier le poste","Connecter","Déconnecter","Retirer mon profil","Quitter"}) {
                var button=(Control)type.GetMethod("ActionButton",BindingFlags.Static|BindingFlags.NonPublic)!.Invoke(null,[label,label=="Connecter"])!;actions.Controls.Add(button);
            }
            form.Controls.Add(actions);form.Controls.Add(new Label{AutoSize=true,Text="Déconnexion terminée. Profil et journal conservés."});root.Controls.Add(profile);
            _=host.Handle;for(var pass=0;pass<5;pass++){host.PerformLayout();root.PerformLayout();stack.PerformLayout();form.PerformLayout();}
            using var bitmap=new Bitmap(host.Width,Math.Min(1150,root.Height));host.DrawToBitmap(bitmap,new Rectangle(Point.Empty,bitmap.Size));bitmap.Save(Path.Combine(outputDirectory,$"desktop-layout-{width}.png"));
            Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(new{width,root=root.Bounds,profile=profile.Bounds,form=form.Bounds,actions=actions.Bounds,buttons=actions.Controls.Cast<Control>().Select(b=>new{b.Text,b.Bounds})}));
            Check(root.Right<=host.ClientSize.Width);
            foreach(Control card in grid.Controls)Check(card.Width>=120);
            foreach(Control button in actions.Controls)Check(button.Bottom<=actions.ClientSize.Height);
            Check(form.Bottom<=profile.ClientSize.Height-profile.Padding.Bottom);
        }
    }
}
