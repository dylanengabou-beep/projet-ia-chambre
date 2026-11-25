# Pilote Apple Music (ou le lecteur actif) avec les contrôles multimédias de Windows.
#   musique.ps1 -Action etat | lecture | pause | suivant | precedent
#   musique.ps1 -Action ouvrir -Lien "music://music.apple.com/..."   (ouvre un titre, un album ou une playlist)
#   musique.ps1 -Action volume -Valeur 25    (volume d'Apple Music seulement, en %, pour baisser la musique quand Sarah parle)
#   musique.ps1 -Action volume -Valeur 20 -Appli spotify   (même chose pour Spotify)
param([string]$Action = 'etat', [string]$Lien = '', [int]$Valeur = 100, [string]$Appli = 'applemusic')
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(5000) | Out-Null; $task.Result }
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]

function Session {
    $mgr = Await ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
    $toutes = $mgr.GetSessions()
    $apple = $toutes | Where-Object { $_.SourceAppUserModelId -match 'AppleMusic' } | Select-Object -First 1
    if ($apple) { return $apple }
    return $mgr.GetCurrentSession()
}

function Etat {
    $s = Session
    if (-not $s) { return 'aucun lecteur ouvert' }
    $info = Await ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
    $lecture = $s.GetPlaybackInfo().PlaybackStatus
    "lecteur={0} | statut={1} | titre={2} | artiste={3}" -f $s.SourceAppUserModelId, $lecture, $info.Title, $info.Artist
}

function VolumeApp([int]$p) {
    Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f,int s,out IntPtr d); int GetDefaultAudioEndpoint(int f,int r,out IMMDevice e); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id,int ctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionManager2 { int A(int a,int b,out IntPtr c); int B(int a,int b,out IntPtr c); int GetSessionEnumerator(out IAudioSessionEnumerator e); }
[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i,out IAudioSessionControl2 s); }
[Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioSessionControl2 { int a(out int s); int b(out IntPtr n); int c(string n,Guid g); int d(out IntPtr p); int e(string p,Guid g);
 int f(out Guid g); int g(Guid g,Guid c); int h(IntPtr n); int i(IntPtr n); int j(out IntPtr s); int k(out IntPtr s); int GetProcessId(out uint p); }
[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface ISimpleAudioVolume { int SetMasterVolume(float l,ref Guid g); int GetMasterVolume(out float l); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public static class VolApp {
  public static int Regler(string nomProcessus, float niveau) {
    var en=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; en.GetDefaultAudioEndpoint(0,1,out d);
    object o; var iid=typeof(IAudioSessionManager2).GUID; d.Activate(ref iid,23,IntPtr.Zero,out o);
    IAudioSessionEnumerator se; ((IAudioSessionManager2)o).GetSessionEnumerator(out se); int n; se.GetCount(out n); int faits=0; var g=Guid.Empty;
    for(int i=0;i<n;i++){ IAudioSessionControl2 s; se.GetSession(i,out s); uint pid; s.GetProcessId(out pid);
      try { if(System.Diagnostics.Process.GetProcessById((int)pid).ProcessName.ToLower().Contains(nomProcessus)) { ((ISimpleAudioVolume)s).SetMasterVolume(niveau, ref g); faits++; } } catch {} }
    return faits; } }
"@
    $n = [VolApp]::Regler($Appli.ToLower(), [Math]::Max(0, [Math]::Min(100, $p)) / 100)
    "volume $Appli = $p % ($n session(s))"
}

# ---------- Recherche et lecture d'un titre dans l'application Apple Music (automatisation de l'interface)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
$AE = [System.Windows.Automation.AutomationElement]
$Desc = [System.Windows.Automation.TreeScope]::Descendants
function Fenetre {
    $p = Get-Process AppleMusic -ErrorAction SilentlyContinue | Where-Object MainWindowHandle -ne 0 | Select-Object -First 1
    if ($p) { return $AE::FromHandle($p.MainWindowHandle) }
}
function Trouver($racine, $type, [scriptblock]$filtre) {
    $racine.FindAll($Desc, (New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $type))) | Where-Object $filtre | Select-Object -First 1
}
function Cliquer($el) { $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke() }
function Attendre([scriptblock]$cond, [int]$secondes = 10) {
    $fin = (Get-Date).AddSeconds($secondes)
    while ((Get-Date) -lt $fin) { $r = & $cond; if ($r) { return $r }; Start-Sleep -Milliseconds 300 }
}

function JouerRecherche([string]$texte) {
    if (-not (Fenetre)) {
        Start-Process 'shell:AppsFolder\AppleInc.AppleMusicWin_nzyj5cx40ttqa!App'
        if (-not (Attendre { Fenetre } 30)) { throw "Apple Music ne s'ouvre pas" }
        Start-Sleep 3
    }
    $f = Fenetre
    $chercherZone = { (Fenetre).FindFirst($Desc, (New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'TextBox'))) }
    $zone = & $chercherZone
    if (-not $zone) {  # n'ouvrir la recherche que si elle est fermée (sinon le bouton la referme)
        Cliquer ($f.FindFirst($Desc, (New-Object System.Windows.Automation.PropertyCondition($AE::AutomationIdProperty, 'Search_Button'))))
        $zone = Attendre $chercherZone
    }
    if (-not $zone) { throw "zone de recherche introuvable" }
    $zone.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($texte)
    $estTitre = { $_.Current.Name -match ' (Song|Chanson) · ' }
    # 1) un titre proposé directement pendant la saisie
    $sugg = Attendre { Trouver (Fenetre) ([System.Windows.Automation.ControlType]::ListItem) $estTitre } 4
    if (-not $sugg) {
        # 2) sinon : lancer la recherche complète (suggestion = texte tapé) et prendre le 1er titre des résultats
        $simple = Trouver (Fenetre) ([System.Windows.Automation.ControlType]::ListItem) { $_.Current.Name -ieq $texte }
        if ($simple) { Cliquer $simple }
        $sugg = Attendre { Trouver (Fenetre) ([System.Windows.Automation.ControlType]::ListItem) $estTitre } 8
    }
    if (-not $sugg) { throw "aucun titre trouvé pour « $texte »" }
    $titre = ($sugg.Current.Name -split ' (Song|Chanson) · ')[0]
    $artiste = ($sugg.Current.Name -split ' (Song|Chanson) · ')[-1]
    Cliquer $sugg   # ouvre la page de l'album
    $motif = '^(Track|Piste) \d+ ' + [regex]::Escape($titre)
    $ligne = Attendre { Trouver (Fenetre) ([System.Windows.Automation.ControlType]::ListItem) { $_.Current.Name -match $motif } } 10
    if (-not $ligne) { throw "titre « $titre » introuvable dans l'album" }
    # menu « … » du titre → « Play “titre” » (un simple clic sur la ligne ne fait que la sélectionner)
    $menuJouer = { Trouver (Fenetre) ([System.Windows.Automation.ControlType]::MenuItem) { $_.Current.Name -match '^(Play|Lire) \S' -and $_.Current.Name -notmatch 'Next|Later|ensuite|suivant' } }
    if (-not (& $menuJouer)) {  # ne pas re-cliquer si le menu est déjà ouvert (ça le refermerait)
        Cliquer ($ligne.FindFirst($Desc, (New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'More'))))
    }
    $jouer = Attendre $menuJouer 6
    if (-not $jouer) { throw "menu « Play » introuvable" }
    Cliquer $jouer
    Start-Sleep 3
    "lance : $titre - $artiste | " + (Etat)
}

switch ($Action) {
    'chercher'  { JouerRecherche $Lien }
    'etat'      { Etat }
    'lecture'   { $s = Session; if ($s) { Await ($s.TryPlayAsync()) ([bool]) | Out-Null }; Start-Sleep -Milliseconds 400; Etat }
    'pause'     { $s = Session; if ($s) { Await ($s.TryPauseAsync()) ([bool]) | Out-Null }; Start-Sleep -Milliseconds 400; Etat }
    'suivant'   { $s = Session; if ($s) { Await ($s.TrySkipNextAsync()) ([bool]) | Out-Null }; Start-Sleep -Milliseconds 800; Etat }
    'precedent' { $s = Session; if ($s) { Await ($s.TrySkipPreviousAsync()) ([bool]) | Out-Null }; Start-Sleep -Milliseconds 800; Etat }
    'ouvrir'    { if ($Lien -notmatch '^musics?://music\.apple\.com/') { throw "lien refusé : $Lien" }; Start-Process $Lien; 'ouvert' }
    'volume'    { VolumeApp $Valeur }
}
