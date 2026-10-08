// INSTALAÇÃO só pro usuário (nunca pede administrador):
//   %LOCALAPPDATA%\Programs\Auto Edit Abrir\AutoEditAbrir.exe
//   HKCU\Software\Classes\autoedit-abrir        → o link que o site chama
//   HKCU\…\Uninstall\AutoEditAbrir              → Configurações > Apps > Desinstalar
//   Menu Iniciar\Programas\Auto Edit Abrir.lnk  → a janela do app
// Nada roda em segundo plano nem inicia com o Windows: o app só abre quando o
// site chama o link, faz o serviço e fecha.

using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using Microsoft.Win32;

namespace AutoEditAbrir
{
    static class Instalador
    {
        public const string Protocolo = "autoedit-abrir";
        public const string NomeDoApp = "Auto Edit Abrir";
        const string ChaveUninstall = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\AutoEditAbrir";
        public const string SiteInstalado = "https://darkoautoedit.com/abrir-projeto?instalado=1&v=";

        public static string Versao
        {
            get { return Assembly.GetExecutingAssembly().GetName().Version.ToString(3); }
        }

        public static string PastaDoApp
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\Auto Edit Abrir"); }
        }

        public static string ExeInstalado
        {
            get { return Path.Combine(PastaDoApp, "AutoEditAbrir.exe"); }
        }

        static string Atalho
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), NomeDoApp + ".lnk"); }
        }

        public static bool RodandoDoLugarInstalado
        {
            get { return string.Equals(Path.GetFullPath(Assembly.GetExecutingAssembly().Location), Path.GetFullPath(ExeInstalado), StringComparison.OrdinalIgnoreCase); }
        }

        /// <summary>Versão instalada (registro), ou null.</summary>
        public static string VersaoInstalada()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(ChaveUninstall))
                {
                    if (k == null || !File.Exists(ExeInstalado)) return null;
                    return k.GetValue("DisplayVersion") as string;
                }
            }
            catch { return null; }
        }

        public static void Instalar()
        {
            Directory.CreateDirectory(PastaDoApp);
            string eu = Assembly.GetExecutingAssembly().Location;
            if (!RodandoDoLugarInstalado)
            {
                // bytes copiados num arquivo NOVO: a cópia instalada nasce sem a
                // marca de "baixado da internet" — o Windows não pergunta de novo
                // a cada projeto aberto.
                byte[] bytes = File.ReadAllBytes(eu);
                string temp = ExeInstalado + ".novo";
                File.WriteAllBytes(temp, bytes);
                if (File.Exists(ExeInstalado))
                {
                    string velho = ExeInstalado + ".velho";
                    try { if (File.Exists(velho)) File.Delete(velho); } catch { }
                    try { File.Move(ExeInstalado, velho); } catch { File.Delete(ExeInstalado); }
                }
                File.Move(temp, ExeInstalado);
                try { File.Delete(ExeInstalado + ".velho"); } catch { /* ainda em uso: some na próxima */ }
            }
            string exe = ExeInstalado;

            using (var k = Registry.CurrentUser.CreateSubKey(@"Software\Classes\" + Protocolo))
            {
                k.SetValue("", "URL:" + NomeDoApp);
                k.SetValue("URL Protocol", "");
                using (var i = k.CreateSubKey("DefaultIcon")) i.SetValue("", "\"" + exe + "\",0");
                using (var c = k.CreateSubKey(@"shell\open\command")) c.SetValue("", "\"" + exe + "\" \"%1\"");
            }
            using (var k = Registry.CurrentUser.CreateSubKey(ChaveUninstall))
            {
                k.SetValue("DisplayName", NomeDoApp);
                k.SetValue("DisplayVersion", Versao);
                k.SetValue("Publisher", "Auto Edit");
                k.SetValue("DisplayIcon", "\"" + exe + "\",0");
                k.SetValue("InstallLocation", PastaDoApp);
                k.SetValue("UninstallString", "\"" + exe + "\" --desinstalar");
                k.SetValue("QuietUninstallString", "\"" + exe + "\" --desinstalar --silencioso");
                k.SetValue("URLInfoAbout", "https://darkoautoedit.com/abrir-projeto");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)Math.Max(1, new FileInfo(exe).Length / 1024), RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
            CriarAtalho(exe);
            Log.Escrever("instalado " + Versao + " em " + exe);
        }

        static void CriarAtalho(string exe)
        {
            try
            {
                Type t = Type.GetTypeFromProgID("WScript.Shell");
                if (t == null) return;
                object shell = Activator.CreateInstance(t);
                object lnk = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { Atalho });
                Type lt = lnk.GetType();
                lt.InvokeMember("TargetPath", BindingFlags.SetProperty, null, lnk, new object[] { exe });
                lt.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, lnk, new object[] { PastaDoApp });
                lt.InvokeMember("Description", BindingFlags.SetProperty, null, lnk, new object[] { "Abre o projeto editável do Auto Edit no CapCut ou no Premiere" });
                lt.InvokeMember("IconLocation", BindingFlags.SetProperty, null, lnk, new object[] { exe + ",0" });
                lt.InvokeMember("Save", BindingFlags.InvokeMethod, null, lnk, null);
            }
            catch (Exception ex) { Log.Escrever("atalho não criado: " + ex.Message); }
        }

        /// <summary>Tira o link, o registro e o atalho. A pasta do app é apagada
        /// por uma cópia temporária do desinstalador (um exe não apaga a si mesmo
        /// enquanto roda) — o mesmo jeito dos desinstaladores comuns.</summary>
        public static void Desinstalar()
        {
            try { Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\" + Protocolo, false); } catch { }
            try { Registry.CurrentUser.DeleteSubKeyTree(ChaveUninstall, false); } catch { }
            try { if (File.Exists(Atalho)) File.Delete(Atalho); } catch { }
            Log.Escrever("desinstalado");
        }

        /// <summary>Roda numa cópia em %TEMP%: espera o app original fechar e apaga a pasta dele.</summary>
        public static void ApagarPastaDoApp(int pidOriginal)
        {
            try
            {
                if (pidOriginal > 0)
                {
                    try { using (var p = Process.GetProcessById(pidOriginal)) p.WaitForExit(15000); } catch { }
                }
                for (int i = 0; i < 10 && Directory.Exists(PastaDoApp); i++)
                {
                    try { Directory.Delete(PastaDoApp, true); } catch { System.Threading.Thread.Sleep(500); }
                }
            }
            catch { }
        }

        /// <summary>Copia o desinstalador pro %TEMP% e manda ele apagar a pasta depois que este processo fechar.</summary>
        public static void AgendarLimpezaDaPasta()
        {
            try
            {
                string temp = Path.Combine(Path.GetTempPath(), "AutoEditAbrir-desinstalar.exe");
                File.WriteAllBytes(temp, File.ReadAllBytes(Assembly.GetExecutingAssembly().Location));
                var psi = new ProcessStartInfo(temp, "--apagar-pasta " + Process.GetCurrentProcess().Id);
                psi.UseShellExecute = false;
                psi.CreateNoWindow = true;
                psi.WorkingDirectory = Path.GetTempPath();
                Process.Start(psi);
            }
            catch (Exception ex) { Log.Escrever("limpeza da pasta não agendada: " + ex.Message); }
        }

        /// <summary>
        /// Abre a página que LIGA o "abrir direto" no navegador onde a pessoa
        /// usa o Pilot. Não pode ser o navegador PADRÃO: no PC do Silas o padrão
        /// é o Firefox, a marca caía lá e o Chrome (onde o Pilot roda, com a
        /// extensão Hey Auto) nunca sabia que o app estava instalado. Ordem:
        /// Chrome → Edge → o padrão do Windows.
        /// </summary>
        public static void AbrirNoNavegador(string url)
        {
            string nav = NavegadorDoPilot();
            try
            {
                var psi = nav != null ? new ProcessStartInfo(nav, "\"" + url + "\"") : new ProcessStartInfo(url);
                psi.UseShellExecute = true;
                Process.Start(psi);
                Log.Escrever("página do app aberta em " + (nav ?? "navegador padrão"));
            }
            catch (Exception ex)
            {
                Log.Escrever("navegador não abriu (" + (nav ?? "padrão") + "): " + ex.Message);
                if (nav == null) return;
                try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }
            }
        }

        /// <summary>chrome.exe (ou msedge.exe) instalado neste PC, ou null.</summary>
        public static string NavegadorDoPilot()
        {
            foreach (var exe in new[] { "chrome.exe", "msedge.exe" })
            {
                foreach (var hive in new[] { Registry.CurrentUser, Registry.LocalMachine })
                {
                    try
                    {
                        using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\" + exe))
                        {
                            string p = k == null ? null : (k.GetValue("") as string ?? "").Trim('"');
                            if (!string.IsNullOrEmpty(p) && File.Exists(p)) return p;
                        }
                    }
                    catch { }
                }
            }
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            foreach (var p in new[]
            {
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
                Path.Combine(local, @"Google\Chrome\Application\chrome.exe"),
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
            })
            {
                if (File.Exists(p)) return p;
            }
            return null;
        }
    }
}
