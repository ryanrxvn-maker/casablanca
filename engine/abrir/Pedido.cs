// O PEDIDO que o site manda: autoedit-abrir://abrir?v=1&alvo=capcut&job=…&zip=…&t=…
//
// Qualquer site pode tentar abrir um link autoedit-abrir://, então nada aqui
// confia no link: ele só diz QUAL .zip esperar. O app só mexe num .zip que
// (1) apareceu DEPOIS do clique, (2) tem o autoedit-job.json com o MESMO id
// do link e (3) só extrai dentro da pasta do projeto (nada de "../").

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace AutoEditAbrir
{
    static class Log
    {
        static readonly object trava = new object();
        public static string Pasta
        {
            get { return Path.Combine(Instalador.PastaDoApp, "logs"); }
        }
        public static void Escrever(string msg)
        {
            try
            {
                lock (trava)
                {
                    Directory.CreateDirectory(Pasta);
                    string arq = Path.Combine(Pasta, DateTime.Now.ToString("yyyy-MM-dd") + ".log");
                    File.AppendAllText(arq, DateTime.Now.ToString("HH:mm:ss.fff") + "  " + msg + Environment.NewLine, new UTF8Encoding(false));
                }
            }
            catch { }
        }
    }

    sealed class Pedido
    {
        public string Alvo;   // capcut | premiere
        public string Job;
        public string Zip;    // nome do .zip que o site baixou
        public long DesdeMs;  // instante do clique (ms desde 1970, relógio deste PC)

        public static Pedido Ler(string link)
        {
            Uri u;
            if (!Uri.TryCreate(link, UriKind.Absolute, out u)) throw new FormatException("link inválido");
            if (!string.Equals(u.Scheme, "autoedit-abrir", StringComparison.OrdinalIgnoreCase)) throw new FormatException("link de outro app");
            var q = Query(u.Query);
            var p = new Pedido();
            p.Alvo = Valor(q, "alvo").ToLowerInvariant();
            if (p.Alvo != "capcut" && p.Alvo != "premiere") throw new FormatException("editor desconhecido: " + p.Alvo);
            p.Job = Valor(q, "job");
            if (!Regex.IsMatch(p.Job, "^[A-Za-z0-9-]{8,64}$")) throw new FormatException("pedido sem identificação válida");
            p.Zip = Path.GetFileName(Valor(q, "zip"));
            if (p.Zip.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0 || !p.Zip.EndsWith(".zip", StringComparison.OrdinalIgnoreCase) || p.Zip.Length > 200)
                throw new FormatException("nome de pacote inválido");
            long t;
            p.DesdeMs = long.TryParse(Valor(q, "t"), NumberStyles.Integer, CultureInfo.InvariantCulture, out t) ? t : AgoraMs();
            return p;
        }

        static Dictionary<string, string> Query(string q)
        {
            var d = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            foreach (var par in (q ?? "").TrimStart('?').Split('&'))
            {
                if (par.Length == 0) continue;
                int i = par.IndexOf('=');
                string k = Uri.UnescapeDataString((i < 0 ? par : par.Substring(0, i)).Replace('+', ' '));
                string v = i < 0 ? "" : Uri.UnescapeDataString(par.Substring(i + 1).Replace('+', ' '));
                d[k] = v;
            }
            return d;
        }

        static string Valor(Dictionary<string, string> q, string k)
        {
            string v;
            return q.TryGetValue(k, out v) ? (v ?? "").Trim() : "";
        }

        public static long AgoraMs()
        {
            return (long)(DateTime.UtcNow - new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc)).TotalMilliseconds;
        }
    }

    /// <summary>O conteúdo do autoedit-job.json que veio dentro do .zip.</summary>
    sealed class JobDoZip
    {
        public string Job;
        public string Alvo;
        public List<string> Pastas = new List<string>();
        public string ZipPath;
    }

    static class Pacote
    {
        public const string ArquivoDoJob = "autoedit-job.json";

        /// <summary>Onde o navegador pode ter salvo o .zip: Downloads do Windows +
        /// a pasta de download configurada no Chrome/Edge/Brave/Opera/Vivaldi.</summary>
        public static List<string> PastasDeDownload()
        {
            var set = new List<string>();
            Action<string> add = delegate (string d)
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(d)) return;
                    d = Path.GetFullPath(Environment.ExpandEnvironmentVariables(d));
                    if (Directory.Exists(d) && !set.Any(x => string.Equals(x, d, StringComparison.OrdinalIgnoreCase))) set.Add(d);
                }
                catch { }
            };
            add(Nativo.PastaDownloads());
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            string roaming = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var raizes = new[]
            {
                Path.Combine(local, @"Google\Chrome\User Data"),
                Path.Combine(local, @"Google\Chrome Beta\User Data"),
                Path.Combine(local, @"Microsoft\Edge\User Data"),
                Path.Combine(local, @"BraveSoftware\Brave-Browser\User Data"),
                Path.Combine(local, @"Vivaldi\User Data"),
                Path.Combine(local, @"Chromium\User Data"),
            };
            var arquivos = new List<string>();
            foreach (var raiz in raizes)
            {
                try
                {
                    if (!Directory.Exists(raiz)) continue;
                    foreach (var perfil in Directory.GetDirectories(raiz))
                    {
                        string nome = Path.GetFileName(perfil);
                        if (nome == "Default" || nome.StartsWith("Profile ", StringComparison.Ordinal)) arquivos.Add(Path.Combine(perfil, "Preferences"));
                    }
                }
                catch { }
            }
            arquivos.Add(Path.Combine(roaming, @"Opera Software\Opera Stable\Preferences"));
            arquivos.Add(Path.Combine(roaming, @"Opera Software\Opera GX Stable\Preferences"));
            foreach (var arq in arquivos)
            {
                foreach (var d in PastasNasPreferencias(arq)) add(d);
            }
            return set;
        }

        /// <summary>"download.default_directory" e "savefile.default_directory" das
        /// preferências do navegador (só essas duas chaves; nada mais é lido).</summary>
        static IEnumerable<string> PastasNasPreferencias(string arquivo)
        {
            var saida = new List<string>();
            try
            {
                if (!File.Exists(arquivo)) return saida;
                string json;
                using (var fs = new FileStream(arquivo, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                using (var sr = new StreamReader(fs, Encoding.UTF8)) json = sr.ReadToEnd();
                var js = new JavaScriptSerializer();
                foreach (Match m in Regex.Matches(json, "\"default_directory\"\\s*:\\s*\"((?:[^\"\\\\]|\\\\.)*)\""))
                {
                    try { saida.Add(js.Deserialize<string>("\"" + m.Groups[1].Value + "\"")); } catch { }
                }
            }
            catch { }
            return saida;
        }

        /// <summary>
        /// Espera o .zip do pedido aparecer (o site monta e baixa DEPOIS do
        /// clique). Devolve null se o usuário cancelar ou o tempo acabar.
        /// </summary>
        public static JobDoZip EsperarZip(Pedido p, Func<bool> cancelado, TimeSpan limite)
        {
            string baseNome = Path.GetFileNameWithoutExtension(p.Zip);
            DateTime desde = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(p.DesdeMs).AddSeconds(-10);
            DateTime fim = DateTime.UtcNow + limite;
            var recusados = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            List<string> pastas = PastasDeDownload();
            Log.Escrever("procurando " + p.Zip + " em: " + string.Join(" | ", pastas));
            int volta = 0;
            while (DateTime.UtcNow < fim && !cancelado())
            {
                // a pasta "salvar como" muda quando o navegador pergunta onde salvar
                if (++volta % 10 == 0) pastas = PastasDeDownload();
                foreach (var dir in pastas)
                {
                    string[] candidatos;
                    try { candidatos = Directory.GetFiles(dir, "*.zip"); } catch { continue; }
                    foreach (var arq in candidatos)
                    {
                        if (recusados.Contains(arq)) continue;
                        string nome = Path.GetFileNameWithoutExtension(arq);
                        // o navegador acrescenta " (1)", " (2)"… quando o nome já existe
                        if (!(nome.Equals(baseNome, StringComparison.OrdinalIgnoreCase)
                            || (nome.StartsWith(baseNome + " (", StringComparison.OrdinalIgnoreCase) && nome.EndsWith(")")))) continue;
                        DateTime quando;
                        try { quando = File.GetLastWriteTimeUtc(arq); } catch { continue; }
                        if (quando < desde) { recusados.Add(arq); continue; }
                        JobDoZip j = LerJob(arq);
                        if (j == null) continue; // ainda sendo escrito: tenta de novo
                        if (j.Job != p.Job) { recusados.Add(arq); Log.Escrever("zip de outro pedido: " + arq); continue; }
                        j.ZipPath = arq;
                        return j;
                    }
                }
                Thread.Sleep(450);
            }
            return null;
        }

        static JobDoZip LerJob(string zip)
        {
            try
            {
                using (var fs = new FileStream(zip, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var z = new ZipArchive(fs, ZipArchiveMode.Read))
                {
                    var e = z.GetEntry(ArquivoDoJob);
                    if (e == null || e.Length > 64 * 1024) return null;
                    string txt;
                    using (var sr = new StreamReader(e.Open(), Encoding.UTF8)) txt = sr.ReadToEnd();
                    var d = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(txt);
                    var j = new JobDoZip();
                    j.Job = Convert.ToString(d.ContainsKey("job") ? d["job"] : "");
                    j.Alvo = Convert.ToString(d.ContainsKey("alvo") ? d["alvo"] : "");
                    var lista = d.ContainsKey("pastas") ? d["pastas"] as System.Collections.IEnumerable : null;
                    if (lista != null) foreach (var x in lista) j.Pastas.Add(Convert.ToString(x));
                    return j;
                }
            }
            catch (Exception ex)
            {
                Log.Escrever("zip ainda não legível (" + Path.GetFileName(zip) + "): " + ex.Message);
                return null;
            }
        }

        /// <summary>Nome de pasta aceito pelo Windows (o site já manda limpo; isto é a 2ª trava).</summary>
        public static string NomeSeguro(string s)
        {
            string limpo = Regex.Replace(s ?? "", "[<>:\"/\\\\|?*\\x00-\\x1f]+", " ");
            limpo = Regex.Replace(limpo, "\\s+", " ").Trim().TrimEnd('.', ' ');
            if (limpo.Length > 120) limpo = limpo.Substring(0, 120).TrimEnd('.', ' ');
            return limpo.Length == 0 ? "PROJETO AUTO EDIT" : limpo;
        }

        /// <summary>"AD01 - PILOT", ou "AD01 - PILOT (2)" se já existir.</summary>
        public static string PastaLivre(string raiz, string nome)
        {
            string baseNome = NomeSeguro(nome);
            string tentativa = baseNome;
            for (int i = 2; Directory.Exists(Path.Combine(raiz, tentativa)) || File.Exists(Path.Combine(raiz, tentativa)); i++)
                tentativa = baseNome + " (" + i + ")";
            return tentativa;
        }

        /// <summary>Quanto a pasta do projeto ocupa descompactada.</summary>
        public static long TamanhoDaPasta(string zip, string pasta)
        {
            long total = 0;
            using (var fs = new FileStream(zip, FileMode.Open, FileAccess.Read, FileShare.Read))
            using (var z = new ZipArchive(fs, ZipArchiveMode.Read))
            {
                foreach (var e in z.Entries)
                    if (e.FullName.StartsWith(pasta + "/", StringComparison.Ordinal)) total += e.Length;
            }
            return total;
        }

        /// <summary>
        /// Extrai SÓ a pasta `pasta/` do .zip para `destino` (que não pode
        /// existir). Escreve numa pasta temporária ao lado e renomeia no fim: o
        /// editor nunca vê um projeto pela metade.
        /// </summary>
        public static void ExtrairPasta(string zip, string pasta, string destino, Action<string> etapa)
        {
            string raiz = Path.GetDirectoryName(destino);
            string temp = Path.Combine(raiz, ".autoedit-" + Guid.NewGuid().ToString("N").Substring(0, 10));
            Directory.CreateDirectory(temp);
            string tempCheio = Path.GetFullPath(temp) + Path.DirectorySeparatorChar;
            try
            {
                using (var fs = new FileStream(zip, FileMode.Open, FileAccess.Read, FileShare.Read))
                using (var z = new ZipArchive(fs, ZipArchiveMode.Read))
                {
                    var entradas = z.Entries.Where(e => e.FullName.StartsWith(pasta + "/", StringComparison.Ordinal)).ToList();
                    int n = 0;
                    foreach (var e in entradas)
                    {
                        n++;
                        string rel = e.FullName.Substring(pasta.Length + 1);
                        if (rel.Length == 0) continue;
                        string alvo = Path.GetFullPath(Path.Combine(temp, rel.Replace('/', Path.DirectorySeparatorChar)));
                        // ZIP SLIP: nada sai da pasta do projeto
                        if (!alvo.StartsWith(tempCheio, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("caminho suspeito no pacote: " + e.FullName);
                        if (e.FullName.EndsWith("/")) { Directory.CreateDirectory(alvo); continue; }
                        Directory.CreateDirectory(Path.GetDirectoryName(alvo));
                        using (var src = e.Open())
                        using (var dst = new FileStream(alvo, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1 << 16))
                            src.CopyTo(dst, 1 << 16);
                        if (n % 25 == 0 && etapa != null) etapa("copiando " + n + "/" + entradas.Count + " arquivos");
                    }
                }
                Directory.Move(temp, destino);
            }
            catch
            {
                try { Directory.Delete(temp, true); } catch { }
                throw;
            }
        }

        /// <summary>Manda o .zip pra Lixeira (dá pra recuperar) depois que o projeto já está no editor.</summary>
        public static void ZipPraLixeira(string zip)
        {
            try
            {
                Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile(zip,
                    Microsoft.VisualBasic.FileIO.UIOption.OnlyErrorDialogs,
                    Microsoft.VisualBasic.FileIO.RecycleOption.SendToRecycleBin);
            }
            catch (Exception ex) { Log.Escrever("zip não foi pra lixeira: " + ex.Message); }
        }

        public static string GB(long bytes)
        {
            return (bytes / 1073741824.0).ToString("0.0", CultureInfo.GetCultureInfo("pt-BR")) + " GB";
        }
    }
}
