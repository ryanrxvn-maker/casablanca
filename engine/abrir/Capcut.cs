// CAPCUT: põe o projeto na pasta de rascunhos de VERDADE, abre o CapCut e
// entra no projeto.
//
// Não existe jeito oficial de mandar o CapCut abrir um rascunho (testado em
// 08.10 no 9.5: o "--draft_path=" só abre a tela inicial com ele fechado e
// derruba o 2º processo com ele aberto). Então o app faz o que a pessoa faria:
// o projeto chega com a CAPA-ASSINATURA rosa, o app acha esse quadrado na
// tela inicial e clica nele. Quem confirma que abriu é o próprio CapCut: ao
// abrir um projeto ele cria o arquivo ".locked" dentro da pasta dele.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using Microsoft.Win32;

namespace AutoEditAbrir
{
    static class Capcut
    {
        // A MESMA cor de lib/pilot-projeto-pastas.ts (CAPA_COR). Mudou lá = muda aqui.
        public static readonly Color CorDaCapa = Color.FromArgb(255, 0, 170);
        public const string ArquivoCapa = "draft_cover.jpg";
        public const string ArquivoCapaFinal = "autoedit-capa-final.jpg";

        public static string PastaPadraoDosRascunhos
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"CapCut\User Data\Projects\com.lveditor.draft"); }
        }

        /// <summary>
        /// A pasta de rascunhos que o CapCut usa: a escolhida em Configurações
        /// (currentCustomDraftPath no globalSetting) ou a padrão.
        /// </summary>
        public static string PastaDosRascunhos()
        {
            string cfg = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"CapCut\User Data\Config\globalSetting");
            try
            {
                if (File.Exists(cfg))
                {
                    foreach (var linha in File.ReadAllLines(cfg, Encoding.UTF8))
                    {
                        if (!linha.StartsWith("currentCustomDraftPath=", StringComparison.Ordinal)) continue;
                        string v = DesescaparQSettings(linha.Substring("currentCustomDraftPath=".Length).Trim());
                        if (v.Length > 0 && Directory.Exists(v)) return Path.GetFullPath(v);
                    }
                }
            }
            catch (Exception ex) { Log.Escrever("globalSetting ilegível: " + ex.Message); }
            return PastaPadraoDosRascunhos;
        }

        /// <summary>O formato INI do Qt: "\\" = "\", "\xHHHH" = letra unicode, aspas opcionais.</summary>
        public static string DesescaparQSettings(string v)
        {
            if (v.Length >= 2 && v[0] == '"' && v[v.Length - 1] == '"') v = v.Substring(1, v.Length - 2);
            var sb = new StringBuilder();
            for (int i = 0; i < v.Length; i++)
            {
                char c = v[i];
                if (c != '\\' || i + 1 >= v.Length) { sb.Append(c); continue; }
                char d = v[i + 1];
                if (d == 'x')
                {
                    int j = i + 2;
                    while (j < v.Length && j < i + 6 && Uri.IsHexDigit(v[j])) j++;
                    if (j > i + 2)
                    {
                        sb.Append((char)int.Parse(v.Substring(i + 2, j - i - 2), NumberStyles.HexNumber));
                        i = j - 1;
                        continue;
                    }
                }
                sb.Append(d == 'n' ? '\n' : d == 't' ? '\t' : d == 'r' ? '\r' : d == '0' ? '\0' : d);
                i++;
            }
            return sb.ToString();
        }

        /// <summary>O CapCut.exe: pelo link capcut:// que o próprio CapCut registra, ou o lugar padrão.</summary>
        public static string Executavel()
        {
            try
            {
                using (var k = Registry.CurrentUser.OpenSubKey(@"Software\Classes\capcut\shell\open\command"))
                {
                    string cmd = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(cmd))
                    {
                        var m = Regex.Match(cmd, "^\\s*\"([^\"]+\\.exe)\"", RegexOptions.IgnoreCase);
                        string exe = m.Success ? m.Groups[1].Value : cmd.Split(new[] { ".exe" }, StringSplitOptions.None)[0] + ".exe";
                        exe = exe.Trim('"', ' ');
                        if (File.Exists(exe)) return exe;
                    }
                }
            }
            catch { }
            string padrao = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"CapCut\Apps\CapCut.exe");
            return File.Exists(padrao) ? padrao : null;
        }

        static string JsonStr(string s)
        {
            var sb = new StringBuilder("\"");
            foreach (char c in s)
            {
                if (c == '"' || c == '\\') sb.Append('\\').Append(c);
                else if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4"));
                else sb.Append(c);
            }
            return sb.Append('"').ToString();
        }

        /// <summary>
        /// Ajusta o draft_meta_info.json pro lugar REAL: pasta, raiz, nome e a
        /// data de agora (vai pro topo da lista). Só troca esses campos — o
        /// resto do arquivo fica byte a byte. UTF-8 SEM BOM (com BOM o CapCut
        /// recusa o projeto).
        /// </summary>
        public static void AjustarMeta(string pastaDoProjeto, string raiz)
        {
            string arq = Path.Combine(pastaDoProjeto, "draft_meta_info.json");
            if (!File.Exists(arq)) throw new FileNotFoundException("o projeto veio sem draft_meta_info.json");
            string json = File.ReadAllText(arq, new UTF8Encoding(false)).TrimStart('﻿');
            string pasta = pastaDoProjeto.Replace('\\', '/');
            string raizBarra = raiz.Replace('\\', '/');
            string nome = Path.GetFileName(pastaDoProjeto);
            long agoraUs = Pedido.AgoraMs() * 1000;
            json = TrocarString(json, "draft_fold_path", pasta);
            json = TrocarString(json, "draft_root_path", raizBarra);
            json = TrocarString(json, "draft_name", nome);
            foreach (var chave in new[] { "tm_draft_create", "tm_draft_modified", "tm_draft_cloud_modified" })
                json = Regex.Replace(json, "\"" + chave + "\"\\s*:\\s*-?\\d+", "\"" + chave + "\":" + agoraUs.ToString(CultureInfo.InvariantCulture));
            File.WriteAllText(arq, json, new UTF8Encoding(false));
        }

        static string TrocarString(string json, string chave, string valor)
        {
            var re = new Regex("\"" + Regex.Escape(chave) + "\"\\s*:\\s*\"(?:[^\"\\\\]|\\\\.)*\"");
            return re.Replace(json, "\"" + chave + "\":" + JsonStr(valor).Replace("$", "$$"), 1);
        }

        /* ───────────────────────── a tela inicial ───────────────────────── */

        /// <summary>A janela principal do CapCut (a maior visível).</summary>
        public static IntPtr JanelaPrincipal()
        {
            IntPtr melhor = IntPtr.Zero;
            long area = 0;
            foreach (var h in Nativo.JanelasDoProcesso("CapCut"))
            {
                Rectangle r = Nativo.Retangulo(h);
                bool minimizada = Nativo.IsIconic(h);
                long a = minimizada ? 1 : (long)r.Width * r.Height;
                if (!minimizada && (r.Width < 500 || r.Height < 350)) continue;
                if (a > area) { area = a; melhor = h; }
            }
            return melhor;
        }

        /// <summary>
        /// Janelinhas de AVISO do CapCut (ex.: "espaço insuficiente em disco"):
        /// médias e CENTRALIZADAS na principal. As notificações do canto ("atalho
        /// de teclado em conflito") e as tirinhas invisíveis não contam.
        /// </summary>
        public static List<IntPtr> Avisos(IntPtr principal)
        {
            var lista = new List<IntPtr>();
            Rectangle p = Nativo.Retangulo(principal);
            foreach (var h in Nativo.JanelasDoProcesso("CapCut"))
            {
                if (h == principal || Nativo.IsIconic(h)) continue;
                Rectangle r = Nativo.Retangulo(h);
                if (r.Width < 220 || r.Height < 150 || r.Width >= 1000 || r.Height >= 800) continue;
                int dx = Math.Abs((r.Left + r.Width / 2) - (p.Left + p.Width / 2));
                int dy = Math.Abs((r.Top + r.Height / 2) - (p.Top + p.Height / 2));
                if (dx <= p.Width * 0.15 && dy <= p.Height * 0.2) lista.Add(h);
            }
            return lista;
        }

        /// <summary>Quando o CapCut que está rodando abriu (o processo mais antigo).</summary>
        public static DateTime InicioDoCapCut()
        {
            DateTime ini = DateTime.MaxValue;
            foreach (var p in Process.GetProcessesByName("CapCut"))
            {
                try { if (p.StartTime < ini) ini = p.StartTime; } catch { }
                p.Dispose();
            }
            return ini;
        }

        public struct Capa
        {
            public Rectangle Area; // em pixels da TELA
            public int Pontos;
            public Point Centro { get { return new Point(Area.Left + Area.Width / 2, Area.Top + Area.Height / 2); } }
        }

        /// <summary>
        /// Os quadrados rosa-choque da tela (as capas-assinatura), em ordem de
        /// leitura (linha de cima primeiro). Grade de 2 em 2 px: rápido e sobra
        /// precisão pra uma miniatura de 100+ px.
        /// </summary>
        public static List<Capa> AcharCapas(Bitmap bmp, Point origem)
        {
            int W = bmp.Width, H = bmp.Height;
            const int passo = 2;
            int gw = W / passo, gh = H / passo;
            var mascara = new bool[gw * gh];
            var dados = bmp.LockBits(new Rectangle(0, 0, W, H), ImageLockMode.ReadOnly, PixelFormat.Format24bppRgb);
            try
            {
                int stride = dados.Stride;
                byte[] linha = new byte[stride];
                for (int gy = 0; gy < gh; gy++)
                {
                    Marshal.Copy(dados.Scan0 + gy * passo * stride, linha, 0, stride);
                    for (int gx = 0; gx < gw; gx++)
                    {
                        int o = gx * passo * 3;
                        int b = linha[o], g = linha[o + 1], r = linha[o + 2];
                        // tolerância pro JPEG da capa e pro escurecido do "passar o mouse"
                        mascara[gy * gw + gx] = r > 150 && g < 90 && b > 85 && b < 230 && r - b > 30 && r - g > 120;
                    }
                }
            }
            finally { bmp.UnlockBits(dados); }

            var capas = new List<Capa>();
            var visto = new bool[gw * gh];
            var fila = new Queue<int>();
            for (int i = 0; i < mascara.Length; i++)
            {
                if (!mascara[i] || visto[i]) continue;
                int minX = int.MaxValue, minY = int.MaxValue, maxX = -1, maxY = -1, n = 0;
                visto[i] = true;
                fila.Enqueue(i);
                while (fila.Count > 0)
                {
                    int k = fila.Dequeue();
                    int x = k % gw, y = k / gw;
                    n++;
                    if (x < minX) minX = x; if (x > maxX) maxX = x;
                    if (y < minY) minY = y; if (y > maxY) maxY = y;
                    if (x > 0 && mascara[k - 1] && !visto[k - 1]) { visto[k - 1] = true; fila.Enqueue(k - 1); }
                    if (x < gw - 1 && mascara[k + 1] && !visto[k + 1]) { visto[k + 1] = true; fila.Enqueue(k + 1); }
                    if (y > 0 && mascara[k - gw] && !visto[k - gw]) { visto[k - gw] = true; fila.Enqueue(k - gw); }
                    if (y < gh - 1 && mascara[k + gw] && !visto[k + gw]) { visto[k + gw] = true; fila.Enqueue(k + gw); }
                }
                int bw = (maxX - minX + 1) * passo, bh = (maxY - minY + 1) * passo;
                double preench = (double)n / ((maxX - minX + 1) * (maxY - minY + 1));
                double prop = (double)bw / Math.Max(1, bh);
                // miniatura: pelo menos 48 px, quase quadrada (ou 9:16 numa lista), cheia de rosa
                if (bw >= 48 && bh >= 48 && prop > 0.45 && prop < 2.2 && preench > 0.55)
                {
                    var c = new Capa();
                    c.Area = new Rectangle(origem.X + minX * passo, origem.Y + minY * passo, bw, bh);
                    c.Pontos = n;
                    capas.Add(c);
                }
            }
            // ordem de leitura: mesma linha = topo a até meia altura de distância
            capas.Sort(delegate (Capa a, Capa b)
            {
                if (Math.Abs(a.Area.Top - b.Area.Top) > Math.Min(a.Area.Height, b.Area.Height) / 2) return a.Area.Top.CompareTo(b.Area.Top);
                return a.Area.Left.CompareTo(b.Area.Left);
            });
            return capas;
        }

        public static bool ProjetoAberto(string pastaDoProjeto)
        {
            return File.Exists(Path.Combine(pastaDoProjeto, ".locked"));
        }

        /// <summary>
        /// Algum OUTRO projeto aberto no editor agora? O ".locked" dele tem de
        /// ter nascido DEPOIS que este CapCut abriu — o que sobra de um CapCut
        /// que fechou torto (travou, foi encerrado) não conta.
        /// </summary>
        public static string OutroProjetoAberto(string raiz, string menos)
        {
            DateTime ini = InicioDoCapCut();
            if (ini == DateTime.MaxValue) return null;
            try
            {
                foreach (var d in Directory.GetDirectories(raiz))
                {
                    if (string.Equals(d, menos, StringComparison.OrdinalIgnoreCase)) continue;
                    var lk = Path.Combine(d, ".locked");
                    if (File.Exists(lk) && File.GetLastWriteTime(lk) >= ini.AddSeconds(-5)) return Path.GetFileName(d);
                }
            }
            catch { }
            return null;
        }

        /// <summary>Troca a capa rosa pela capa real (1º quadro), quando o pacote trouxe.</summary>
        public static void TrocarCapa(string pastaDoProjeto)
        {
            string final = Path.Combine(pastaDoProjeto, ArquivoCapaFinal);
            if (!File.Exists(final)) return;
            for (int i = 0; i < 6; i++)
            {
                try
                {
                    File.Copy(final, Path.Combine(pastaDoProjeto, ArquivoCapa), true);
                    File.Delete(final);
                    return;
                }
                catch { Thread.Sleep(500); }
            }
        }

        public enum Resultado { Aberto, NaLista, Cancelado }

        /// <summary>
        /// Abre o CapCut (ou traz pra frente) e entra no projeto. `etapa` mostra
        /// o andamento na janelinha; `cancelado` é o X dela.
        /// </summary>
        public static Resultado AbrirProjeto(string pastaDoProjeto, string raiz, Action<string, string> etapa, Func<bool> cancelado, Action<Point> antesDeClicar)
        {
            string exe = Executavel();
            IntPtr janela = JanelaPrincipal();
            if (janela == IntPtr.Zero)
            {
                if (exe == null) throw new InvalidOperationException("não achei o CapCut neste PC");
                etapa("Abrindo o CapCut…", "ele leva uns segundos pra carregar");
                Log.Escrever("iniciando " + exe);
                var psi = new ProcessStartInfo(exe);
                psi.UseShellExecute = true;
                psi.WorkingDirectory = Path.GetDirectoryName(exe);
                Process.Start(psi);
                DateTime ate = DateTime.UtcNow.AddSeconds(90);
                while (janela == IntPtr.Zero && DateTime.UtcNow < ate && !cancelado())
                {
                    Thread.Sleep(500);
                    janela = JanelaPrincipal();
                }
                if (janela == IntPtr.Zero) return cancelado() ? Resultado.Cancelado : Resultado.NaLista;
                Thread.Sleep(2500); // a tela inicial termina de montar
            }

            etapa("Entrando no projeto…", "procurando o " + Path.GetFileName(pastaDoProjeto) + " na tela inicial do CapCut");
            DateTime limite = DateTime.UtcNow.AddMinutes(3);
            Rectangle anterior = Rectangle.Empty;
            int cliques = 0;
            DateTime ultimoClique = DateTime.MinValue;
            bool avisouOutro = false, avisouAviso = false, avisouMexendo = false;
            string msgEntrando = "procurando o " + Path.GetFileName(pastaDoProjeto) + " na tela inicial do CapCut";
            while (DateTime.UtcNow < limite && !cancelado())
            {
                if (ProjetoAberto(pastaDoProjeto)) return Resultado.Aberto;
                janela = JanelaPrincipal();
                if (janela == IntPtr.Zero) { Thread.Sleep(600); continue; }

                // uma janelinha de aviso do CapCut por cima (ex.: "espaço em disco"): quem responde é a pessoa
                var avisos = Avisos(janela);
                if (avisos.Count > 0)
                {
                    if (!avisouAviso) { etapa("O CapCut mostrou um aviso", "responda na tela dele — assim que o projeto abrir eu confirmo aqui"); avisouAviso = true; }
                    Thread.Sleep(700);
                    continue;
                }

                if (Nativo.IsIconic(janela)) Nativo.ShowWindow(janela, Nativo.SW_RESTORE);
                Nativo.TrazerPraFrente(janela);
                Rectangle r = Nativo.Retangulo(janela);
                if (r.Width < 200 || r.Height < 200) { Thread.Sleep(500); continue; }
                List<Capa> capas;
                using (var bmp = Nativo.Capturar(r)) capas = AcharCapas(bmp, r.Location);

                if (capas.Count == 0)
                {
                    string outro = OutroProjetoAberto(raiz, pastaDoProjeto);
                    if (outro != null && !avisouOutro)
                    {
                        etapa("Feche o projeto aberto no CapCut", "\"" + outro + "\" está aberto — volte pra tela inicial e eu entro no novo sozinho");
                        avisouOutro = true;
                    }
                    anterior = Rectangle.Empty;
                    Thread.Sleep(700);
                    continue;
                }

                if (avisouOutro || avisouAviso) { etapa("Entrando no projeto…", msgEntrando); avisouOutro = avisouAviso = false; }
                Capa alvo = capas[0];
                // a mesma capa no mesmo lugar em 2 prints seguidos = a lista parou de mexer
                bool parado = !anterior.IsEmpty && Math.Abs(anterior.Left - alvo.Area.Left) <= 4 && Math.Abs(anterior.Top - alvo.Area.Top) <= 4;
                anterior = alvo.Area;
                if (!parado) { Thread.Sleep(450); continue; }
                if ((DateTime.UtcNow - ultimoClique).TotalSeconds < 6) { Thread.Sleep(500); continue; }
                if (cliques >= 3) { Thread.Sleep(700); continue; }

                // a pessoa está usando o PC agora: espera ela parar (o clique não pode brigar com ela)
                if (Nativo.PessoaMexendo(1500))
                {
                    if (!avisouMexendo) { etapa("Entrando no projeto…", "assim que você soltar o mouse e o teclado por 1 segundo, eu clico no projeto"); avisouMexendo = true; }
                    anterior = Rectangle.Empty;
                    Thread.Sleep(400);
                    continue;
                }
                if (avisouMexendo) { etapa("Entrando no projeto…", msgEntrando); avisouMexendo = false; }
                // só clica com o CapCut na frente (senão o clique cairia em outro programa)
                if (Nativo.GetForegroundWindow() != janela && !Nativo.TrazerPraFrente(janela)) { Thread.Sleep(500); continue; }
                Point c = alvo.Centro;
                // a janelinha do app não pode estar em cima do ponto do clique
                if (antesDeClicar != null) { antesDeClicar(c); Thread.Sleep(200); }
                // a capa ainda está ali? (print NOVO, logo antes de clicar)
                List<Capa> conferida;
                using (var bmp2 = Nativo.Capturar(r)) conferida = AcharCapas(bmp2, r.Location);
                if (conferida.Count == 0 || !conferida[0].Area.Contains(c)) { anterior = Rectangle.Empty; continue; }
                bool clicou = Nativo.Clicar(c.X, c.Y, janela);
                Log.Escrever((clicou ? "clicou" : "NÃO clicou (outra janela no ponto ou fora da frente)") + " na capa em " + c + " (" + capas.Count + " capa(s) na tela)");
                if (!clicou) { anterior = Rectangle.Empty; Thread.Sleep(600); continue; }
                cliques++;
                ultimoClique = DateTime.UtcNow;
                for (int i = 0; i < 16 && !cancelado(); i++)
                {
                    if (ProjetoAberto(pastaDoProjeto)) return Resultado.Aberto;
                    Thread.Sleep(500);
                }
            }
            return cancelado() ? Resultado.Cancelado : Resultado.NaLista;
        }
    }
}
