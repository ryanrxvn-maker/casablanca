// Auto Edit Downloader — Setup.exe (stub C# nativo)
//
// Compilado com csc.exe v4 do .NET Framework (vem com Windows).
// Tem o pkg.zip embutido como recurso. Quando rodado:
//   1) extrai o zip pra %TEMP%\AutoEditSetup_<rand>\
//   2) executa Instalar.ps1 com WindowStyle Hidden / Bypass
//   3) sai imediatamente — a UI bonita do .ps1 segue rodando
//
// Icone do .exe vem do icon.ico embutido em /win32icon: na compilacao.

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Windows.Forms;

namespace AutoEdit
{
    static class Setup
    {
        [STAThread]
        static int Main()
        {
            try
            {
                // 1) extrai o recurso pkg.zip pra %TEMP%\AutoEditSetup_<rand>\
                string tmp = Path.Combine(
                    Path.GetTempPath(),
                    "AutoEditSetup_" + Guid.NewGuid().ToString("N").Substring(0, 8));
                Directory.CreateDirectory(tmp);

                Assembly asm = Assembly.GetExecutingAssembly();
                string resName = null;
                foreach (string n in asm.GetManifestResourceNames())
                {
                    if (n.EndsWith("pkg.zip", StringComparison.OrdinalIgnoreCase))
                    {
                        resName = n;
                        break;
                    }
                }
                if (resName == null)
                {
                    MessageBox.Show(
                        "Recurso interno faltando (pkg.zip). Baixe o instalador novamente.",
                        "Auto Edit Downloader",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 2;
                }

                string zipPath = Path.Combine(tmp, "pkg.zip");
                using (Stream src = asm.GetManifestResourceStream(resName))
                using (FileStream dst = File.Create(zipPath))
                {
                    src.CopyTo(dst);
                }
                ZipFile.ExtractToDirectory(zipPath, tmp);
                try { File.Delete(zipPath); } catch { }

                // 2) roda Instalar.ps1 com a UI DARKO. WindowStyle Hidden
                //    pra esconder o console; o .ps1 cria a propria janela.
                string ps1 = Path.Combine(tmp, "Instalar.ps1");
                if (!File.Exists(ps1))
                {
                    MessageBox.Show(
                        "Arquivo de instalacao ausente apos a extracao.",
                        "Auto Edit Downloader",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return 3;
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \""
                    + ps1 + "\"";
                psi.WorkingDirectory = tmp;
                psi.UseShellExecute = true;
                psi.WindowStyle = ProcessWindowStyle.Hidden;
                Process.Start(psi);

                // 3) sai. O ps1 mostra UI propria e cuida do resto.
                return 0;
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Erro ao iniciar a instalacao:\r\n\r\n" + ex.Message,
                    "Auto Edit Downloader",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }
    }
}
