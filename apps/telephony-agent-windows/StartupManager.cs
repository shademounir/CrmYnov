using Microsoft.Win32;

namespace CrmYnov.TelephonyAgent;

internal static class StartupManager
{
    private const string RegistryPath = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string ValueName = "CRM Ynov Telephony Agent";

    public static bool Enabled
    {
        get {
            using var key = Registry.CurrentUser.OpenSubKey(RegistryPath, false);
            return key?.GetValue(ValueName) is string value && !string.IsNullOrWhiteSpace(value);
        }
        set {
            using var key = Registry.CurrentUser.CreateSubKey(RegistryPath, true);
            if (value) key.SetValue(ValueName, $"\"{Application.ExecutablePath}\"");
            else key.DeleteValue(ValueName, false);
        }
    }
}
