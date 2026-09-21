using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;

namespace CrmYnov.TelephonyAgent.Installer;

internal sealed record InstallerMetadata(string Version, string PackageFolder, string PackageSha256);

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var quiet = args.Any(argument => string.Equals(argument, "--quiet", StringComparison.OrdinalIgnoreCase));
        var work = Path.Combine(Path.GetTempPath(), $"crm-ynov-agent-install-{Guid.NewGuid():N}");
        try
        {
            Directory.CreateDirectory(work);
            var assembly = Assembly.GetExecutingAssembly();
            var metadata = ReadMetadata(assembly);
            var archive = Path.Combine(work, "agent-package.zip");
            using (var source = assembly.GetManifestResourceStream("AgentPackage.zip") ?? throw new InvalidOperationException("INSTALLER_PACKAGE_MISSING"))
            using (var target = File.Create(archive)) source.CopyTo(target);
            using var hashStream = File.OpenRead(archive);
            var hash = SHA256.HashData(hashStream);
            if (!CryptographicOperations.FixedTimeEquals(hash, Convert.FromHexString(metadata.PackageSha256)))
                throw new InvalidOperationException("INSTALLER_PACKAGE_HASH_MISMATCH");

            var package = Path.Combine(work, metadata.PackageFolder);
            Directory.CreateDirectory(package);
            ZipFile.ExtractToDirectory(archive, package);
            var script = Path.Combine(package, "install-windows-agent.ps1");
            if (!File.Exists(script)) throw new InvalidOperationException("INSTALLER_SCRIPT_MISSING");
            var process = Process.Start(new ProcessStartInfo
            {
                FileName = "powershell.exe",
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                WorkingDirectory = package,
                ArgumentList = { "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, "-PackageDirectory", package, "-Version", metadata.Version },
            }) ?? throw new InvalidOperationException("INSTALLER_PROCESS_START_FAILED");
            var output = process.StandardOutput.ReadToEnd();
            var error = process.StandardError.ReadToEnd();
            process.WaitForExit();
            if (process.ExitCode != 0) throw new InvalidOperationException(SafeInstallerError(error, output));
            ClearSafeFailureLog();

            if (!quiet)
                MessageBox.Show(
                    $"CRM Ynov Telephony Agent {metadata.Version} est installé pour cette session Windows.\n\nL’assistant est ouvert pour associer le poste et choisir les périphériques audio.",
                    "Installation terminée", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        catch (Exception error)
        {
            var safeCode = SafeCode(error);
            WriteSafeFailureLog(safeCode);
            if (!quiet)
                MessageBox.Show($"Installation impossible : {safeCode}", "CRM Ynov Telephony Agent", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        finally
        {
            try
            {
                var resolved = Path.GetFullPath(work);
                var temp = Path.GetFullPath(Path.GetTempPath());
                if (resolved.StartsWith(temp, StringComparison.OrdinalIgnoreCase) && Directory.Exists(resolved)) Directory.Delete(resolved, true);
            }
            catch { }
        }
    }

    private static InstallerMetadata ReadMetadata(Assembly assembly)
    {
        using var stream = assembly.GetManifestResourceStream("InstallerMetadata.json") ?? throw new InvalidOperationException("INSTALLER_METADATA_MISSING");
        return JsonSerializer.Deserialize<InstallerMetadata>(stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("INSTALLER_METADATA_INVALID");
    }

    private static string SafeInstallerError(string error, string output)
    {
        var source = string.IsNullOrWhiteSpace(error) ? output : error;
        if (source.Contains("VERSION_ALREADY_INSTALLED", StringComparison.Ordinal)) return "VERSION_ALREADY_INSTALLED";
        if (source.Contains("PACKAGE_HASH_MISMATCH", StringComparison.Ordinal)) return "PACKAGE_HASH_MISMATCH";
        if (source.Contains("PACKAGE_FILE_MISSING", StringComparison.Ordinal)) return "PACKAGE_FILE_MISSING";
        return "INSTALLER_SCRIPT_FAILED";
    }

    private static string SafeCode(Exception error) => error is InvalidOperationException invalid && invalid.Message.All(character => char.IsAsciiLetterOrDigit(character) || character == '_')
        ? invalid.Message
        : "INSTALLER_UNAVAILABLE";

    private static void WriteSafeFailureLog(string code)
    {
        try
        {
            var root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CRM Ynov", "Telephony Agent");
            Directory.CreateDirectory(root);
            File.WriteAllText(Path.Combine(root, "installer-last-error.txt"), $"{DateTimeOffset.UtcNow:O}|{code}");
        }
        catch { }
    }

    private static void ClearSafeFailureLog()
    {
        try
        {
            var path = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CRM Ynov", "Telephony Agent", "installer-last-error.txt");
            if (File.Exists(path)) File.Delete(path);
        }
        catch { }
    }
}
