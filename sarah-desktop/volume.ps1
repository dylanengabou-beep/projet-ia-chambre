# Règle le volume de la sortie audio par défaut de Windows.
#   volume.ps1 -Action niveau   -Valeur 40     (met à 40 %)
#   volume.ps1 -Action monter   -Valeur 10     (+10 %)
#   volume.ps1 -Action baisser  -Valeur 10     (-10 %)
#   volume.ps1 -Action muet  |  -Action son    (coupe / remet le son)
#   volume.ps1 -Action lire                    (affiche le volume actuel)
param([string]$Action = 'lire', [int]$Valeur = 10)
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices;
[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDeviceEnumerator { int EnumAudioEndpoints(int f,int s,out IntPtr d); int GetDefaultAudioEndpoint(int f,int r,out IMMDevice e); }
[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMMDevice { int Activate(ref Guid id,int ctx,IntPtr p,[MarshalAs(UnmanagedType.IUnknown)] out object o); }
[Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IAudioEndpointVolume { int RegisterControlChangeNotify(IntPtr p); int UnregisterControlChangeNotify(IntPtr p); int GetChannelCount(out int c);
 int SetMasterVolumeLevel(float l,Guid g); int SetMasterVolumeLevelScalar(float l,ref Guid g); int GetMasterVolumeLevel(out float l); int GetMasterVolumeLevelScalar(out float l);
 int SetChannelVolumeLevel(int c,float l,Guid g); int SetChannelVolumeLevelScalar(int c,float l,Guid g); int GetChannelVolumeLevel(int c,out float l); int GetChannelVolumeLevelScalar(int c,out float l);
 int SetMute([MarshalAs(UnmanagedType.Bool)] bool m,ref Guid g); int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m); }
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumerator {}
public static class Vol {
  static IAudioEndpointVolume Ep() { var en=(IMMDeviceEnumerator)new MMDeviceEnumerator(); IMMDevice d; en.GetDefaultAudioEndpoint(0,1,out d);
    object o; var iid=typeof(IAudioEndpointVolume).GUID; d.Activate(ref iid,23,IntPtr.Zero,out o); return (IAudioEndpointVolume)o; }
  public static int Lire() { float l; Ep().GetMasterVolumeLevelScalar(out l); return (int)Math.Round(l*100); }
  public static bool Muet() { bool m; Ep().GetMute(out m); return m; }
  public static void Regler(int p) { var g=Guid.Empty; var e=Ep(); e.SetMasterVolumeLevelScalar(Math.Max(0,Math.Min(100,p))/100f, ref g); e.SetMute(false, ref g); }
  public static void Couper(bool m) { var g=Guid.Empty; Ep().SetMute(m, ref g); }
}
"@
switch ($Action) {
  'niveau'  { [Vol]::Regler($Valeur) }
  'monter'  { [Vol]::Regler([Vol]::Lire() + $Valeur) }
  'baisser' { [Vol]::Regler([Vol]::Lire() - $Valeur) }
  'muet'    { [Vol]::Couper($true) }
  'son'     { [Vol]::Couper($false) }
}
"volume={0} muet={1}" -f [Vol]::Lire(), [Vol]::Muet()
