// =============================================================
//  Auto Edit Downloader — Setup.exe
//  Stub C# que extrai pkg.zip embutido e roda Instalar.ps1.
// =============================================================
//
// Estratégia anti-antivírus (sem certificado de code signing):
//   - Console visível (NÃO winexe escondendo a janela)
//   - SEM ShowWindow hide, SEM WindowStyle Hidden
//   - SEM VBS gerado dinamicamente
//   - SEM Startup folder modificação direta (usa Task Scheduler)
//   - Manifest com asInvoker (não pede UAC)
//   - AssemblyInfo com CompanyName/Description completos
//   - PowerShell rodado com -NoProfile -ExecutionPolicy Bypass mas
//     SEM -WindowStyle Hidden (Defender adora odiar Hidden)
//   - UseShellExecute=false + CreateNoWindow=false → janela aparece
//
// Resultado: Defender/Avast veem um .exe com metadata completa que
// extrai um zip e roda PowerShell num console VISÍVEL. Não combina
// com nenhum dos patterns clássicos de loader/dropper.
// =============================================================

using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;

namespace AutoEdit
{
    static class Setup
    {
        static int Main()
        {
            Console.Title = "Auto Edit - Instalar Downloader";
            Console.WriteLine();
            Console.WriteLine("  AUTO EDIT - INSTALAR DOWNLOADER");
            Console.WriteLine("  --------------------------------");
            Console.WriteLine("  Aguarde... pode levar 1-3 min na primeira vez.");
            Console.WriteLine();

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
                    Console.WriteLine("[ERRO] Recurso interno faltando (pkg.zip). Baixe o instalador novamente.");
                    Console.WriteLine();
                    Console.WriteLine("Pressione qualquer tecla pra sair...");
                    Console.ReadKey(true);
                    return 2;
                }

                Console.WriteLine("[ OK ] Extraindo arquivos...");
                string zipPath = Path.Combine(tmp, "pkg.zip");
                using (Stream src = asm.GetManifestResourceStream(resName))
                using (FileStream dst = File.Create(zipPath))
                {
                    src.CopyTo(dst);
                }
                ZipFile.ExtractToDirectory(zipPath, tmp);
                try { File.Delete(zipPath); } catch { }

                // 2) roda Instalar.ps1 NA MESMA JANELA (console visível).
                //    Sem -WindowStyle Hidden — esse é o flag anti-AV mais
                //    importante. UseShellExecute=false faz powershell.exe
                //    herdar o console pai (não cria nova janela).
                string ps1 = Path.Combine(tmp, "Instalar.ps1");
                if (!File.Exists(ps1))
                {
                    Console.WriteLine("[ERRO] Arquivo de instalacao ausente apos a extracao.");
                    Console.WriteLine();
                    Console.WriteLine("Pressione qualquer tecla pra sair...");
                    Console.ReadKey(true);
                    return 3;
                }

                ProcessStartInfo psi = new ProcessStartInfo();
                psi.FileName = "powershell.exe";
                psi.Arguments = "-NoProfile -ExecutionPolicy Bypass -File \""
                    + ps1 + "\"";
                psi.WorkingDirectory = tmp;
                psi.UseShellExecute = false;   // herda o console pai
                psi.CreateNoWindow = false;     // janela visível
                psi.RedirectStandardOutput = false;
                psi.RedirectStandardError = false;

                Process p = Process.Start(psi);
                p.WaitForExit();
                int code = p.ExitCode;

                Console.WriteLine();
                if (code == 0)
                {
                    Console.WriteLine("[ OK ] Instalado e vinculado com sucesso.");
                }
                else
                {
                    Console.WriteLine("[AVISO] Instalacao terminou com codigo " + code + ".");
                    Console.WriteLine("Log completo: %LOCALAPPDATA%\\AutoEditDownloader\\install.log");
                }
                Console.WriteLine();
                Console.WriteLine("Pressione qualquer tecla pra fechar esta janela.");
                Console.ReadKey(true);

                // limpa o tmp
                try { Directory.Delete(tmp, true); } catch { }

                return code;
            }
            catch (Exception ex)
            {
                Console.WriteLine();
                Console.WriteLine("[ERRO] " + ex.Message);
                Console.WriteLine();
                Console.WriteLine("Pressione qualquer tecla pra sair...");
                Console.ReadKey(true);
                return 1;
            }
        }
    }
}
