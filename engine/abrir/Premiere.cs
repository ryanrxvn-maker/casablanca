// PREMIERE: o XML aponta a mídia pra C:\AUTOEDIT\<pasta>\MIDIA — o app
// extrai exatamente lá, então nada pede "Vincular mídia". Depois abre o XML
// no Premiere Pro instalado.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace AutoEditAbrir
{
    static class Premiere
    {
        public const string Raiz = @"C:\AUTOEDIT";

        /// <summary>O Adobe Premiere Pro.exe mais novo instalado (ou null).</summary>
        public static string Executavel()
        {
            var achados = new List<string>();
            Action<string> add = delegate (string p)
            {
                try { if (!string.IsNullOrEmpty(p) && File.Exists(p) && !achados.Contains(p, StringComparer.OrdinalIgnoreCase)) achados.Add(p); } catch { }
            };
            foreach (var hive in new[] { Registry.LocalMachine, Registry.CurrentUser })
            {
                try
                {
                    using (var k = hive.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Adobe Premiere Pro.exe"))
                        if (k != null) add((k.GetValue("") as string ?? "").Trim('"'));
                }
                catch { }
            }
            foreach (var pf in new[] { Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"C:\Program Files" })
            {
                try
                {
                    string adobe = Path.Combine(pf, "Adobe");
                    if (!Directory.Exists(adobe)) continue;
                    foreach (var d in Directory.GetDirectories(adobe, "Adobe Premiere Pro*"))
                        add(Path.Combine(d, "Adobe Premiere Pro.exe"));
                }
                catch { }
            }
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Classes\adobe+ppro\shell\open\command"))
                {
                    string cmd = k == null ? null : k.GetValue("") as string;
                    var m = cmd == null ? Match.Empty : Regex.Match(cmd, "\"([^\"]+Premiere Pro\\.exe)\"", RegexOptions.IgnoreCase);
                    if (m.Success) add(m.Groups[1].Value);
                }
            }
            catch { }
            // a versão mais nova: "Adobe Premiere Pro 2026" > "… 2025"; Beta por último
            return achados
                .OrderBy(p => p.IndexOf("Beta", StringComparison.OrdinalIgnoreCase) >= 0 ? 1 : 0)
                .ThenByDescending(p => p, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault();
        }

        /// <summary>
        /// Se a pasta do projeto teve de ganhar um "(2)" (já existia uma igual),
        /// o XML passa a apontar pra pasta nova — senão o Premiere pediria a mídia.
        /// </summary>
        public static void ApontarXmlPraPasta(string xml, string pastaOriginal, string pastaFinal)
        {
            if (string.Equals(pastaOriginal, pastaFinal, StringComparison.Ordinal)) return;
            string txt = File.ReadAllText(xml, new UTF8Encoding(false));
            // file://localhost/C%3a/AUTOEDIT/<pasta codificada>/MIDIA/…
            var m = Regex.Match(txt, "file://localhost/C%3a/AUTOEDIT/([^/<]+)/MIDIA/", RegexOptions.IgnoreCase);
            if (!m.Success) return;
            string antigo = m.Groups[1].Value;
            string sufixo = pastaFinal.StartsWith(pastaOriginal, StringComparison.Ordinal) ? pastaFinal.Substring(pastaOriginal.Length) : null;
            string novo = sufixo != null
                ? antigo + Uri.EscapeDataString(sufixo).Replace("%28", "(").Replace("%29", ")")
                : Uri.EscapeDataString(pastaFinal);
            txt = txt.Replace("/AUTOEDIT/" + antigo + "/MIDIA/", "/AUTOEDIT/" + novo + "/MIDIA/");
            File.WriteAllText(xml, txt, new UTF8Encoding(false));
        }

        public static string XmlDaPasta(string pasta)
        {
            return Directory.GetFiles(pasta, "*.xml").OrderBy(x => x, StringComparer.OrdinalIgnoreCase).FirstOrDefault();
        }

        /// <summary>Abre o XML no Premiere. false = Premiere não instalado.</summary>
        public static bool Abrir(string xml)
        {
            string exe = Executavel();
            if (exe == null) return false;
            Log.Escrever("abrindo no Premiere: " + exe + " \"" + xml + "\"");
            var psi = new ProcessStartInfo(exe, "\"" + xml + "\"");
            psi.UseShellExecute = true;
            psi.WorkingDirectory = Path.GetDirectoryName(exe);
            Process.Start(psi);
            return true;
        }
    }
}
