// AUTO EDIT ABRIR — o app do PC que abre o projeto editável do Pilot direto
// no CapCut ou no Premiere (08.10).
//
//   sem argumento                 → instalador (instala / atualiza / desinstala)
//   autoedit-abrir://abrir?…      → o pedido do site (Chrome chama o link)
//   --desinstalar [--silencioso]  → Configurações > Apps > Desinstalar
//   --diagnostico <arquivo>       → escreve o que achou neste PC (suporte e testes)

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace AutoEditAbrir
{
    static class Programa
    {
        [STAThread]
        static int Main(string[] args)
        {
            Nativo.LigarDpi();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            try
            {
                if (args.Length >= 1 && args[0].StartsWith(Instalador.Protocolo + ":", StringComparison.OrdinalIgnoreCase))
                    return RodarPedido(args[0]);
                if (args.Length >= 2 && args[0] == "--apagar-pasta")
                {
                    int pid;
                    int.TryParse(args[1], out pid);
                    Instalador.ApagarPastaDoApp(pid);
                    return 0;
                }
                if (args.Contains("--desinstalar"))
                {
                    Instalador.Desinstalar();
                    if (Instalador.RodandoDoLugarInstalado) Instalador.AgendarLimpezaDaPasta();
                    if (!args.Contains("--silencioso"))
                        MessageBox.Show("O Auto Edit Abrir foi removido deste PC.", Instalador.NomeDoApp, MessageBoxButtons.OK, MessageBoxIcon.Information);
                    return 0;
                }
                if (args.Contains("--instalar-silencioso")) { Instalador.Instalar(); return 0; }
                if (args.Length >= 2 && args[0] == "--diagnostico") { Diagnostico(args[1]); return 0; }
                Application.Run(new TelaInstalador());
                return 0;
            }
            catch (Exception ex)
            {
                Log.Escrever("erro geral: " + ex);
                MessageBox.Show("Algo deu errado: " + ex.Message, Instalador.NomeDoApp, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }

        static void Diagnostico(string arquivo)
        {
            var sb = new StringBuilder();
            sb.AppendLine("versao=" + Instalador.Versao);
            sb.AppendLine("instalado=" + (Instalador.VersaoInstalada() ?? ""));
            sb.AppendLine("capcut_exe=" + (Capcut.Executavel() ?? ""));
            sb.AppendLine("capcut_rascunhos=" + Capcut.PastaDosRascunhos());
            sb.AppendLine("premiere_exe=" + (Premiere.Executavel() ?? ""));
            sb.AppendLine("navegador_pilot=" + (Instalador.NavegadorDoPilot() ?? ""));
            foreach (var d in Pacote.PastasDeDownload()) sb.AppendLine("downloads=" + d);
            File.WriteAllText(arquivo, sb.ToString(), new UTF8Encoding(false));
        }

        static KeyValuePair<string, Action> Botao(string nome, Action acao)
        {
            return new KeyValuePair<string, Action>(nome, acao);
        }

        static void AbrirPasta(string pasta)
        {
            try { Process.Start(new ProcessStartInfo("explorer.exe", "\"" + pasta + "\"") { UseShellExecute = true }); } catch { }
        }

        static int RodarPedido(string link)
        {
            Log.Escrever("pedido: " + link);
            Pedido p;
            try { p = Pedido.Ler(link); }
            catch (Exception ex)
            {
                Log.Escrever("link recusado: " + ex.Message);
                var j = new Janelinha("app");
                j.Shown += delegate { j.Erro("Esse link não é de um projeto do Auto Edit", ex.Message); };
                Application.Run(j);
                return 2;
            }
            var janela = new Janelinha(p.Alvo);
            string nomeEditor = p.Alvo == "premiere" ? "Premiere" : "CapCut";
            janela.Shown += delegate
            {
                janela.Etapa("Preparando o projeto pro " + nomeEditor, "o Auto Edit está montando o pacote no navegador…");
                var t = new Thread(delegate () { Fluxo(p, janela, nomeEditor); });
                t.IsBackground = true;
                t.Start();
            };
            Application.Run(janela);
            return 0;
        }

        static void Fluxo(Pedido p, Janelinha janela, string nomeEditor)
        {
            try
            {
                JobDoZip job = Pacote.EsperarZip(p, () => janela.Cancelado, TimeSpan.FromMinutes(20));
                if (janela.Cancelado) return;
                if (job == null)
                {
                    janela.Erro("Não achei o pacote baixado", "Ele não apareceu na pasta de downloads em 20 minutos. Clique de novo em Projeto editável no Pilot.");
                    return;
                }
                Log.Escrever("pacote: " + job.ZipPath + " (" + job.Pastas.Count + " projeto(s))");
                if (!string.Equals(job.Alvo, p.Alvo, StringComparison.OrdinalIgnoreCase) || job.Pastas.Count == 0)
                {
                    janela.Erro("Pacote diferente do pedido", "Baixe de novo pelo Pilot.");
                    return;
                }
                if (p.Alvo == "capcut") FluxoCapCut(job, janela);
                else FluxoPremiere(job, janela);
            }
            catch (Exception ex)
            {
                Log.Escrever("falhou: " + ex);
                if (!janela.Cancelado) janela.Erro("Não deu pra abrir no " + nomeEditor, ex.Message);
            }
        }

        static void ConferirEspaco(string zip, IEnumerable<string> pastas, string destino)
        {
            long precisa = pastas.Sum(x => Pacote.TamanhoDaPasta(zip, x)) + 200L * 1024 * 1024;
            var drive = new DriveInfo(Path.GetPathRoot(Path.GetFullPath(destino)));
            if (drive.IsReady && drive.AvailableFreeSpace < precisa)
                throw new IOException("Falta espaço no disco " + drive.Name.TrimEnd('\\') + ": o projeto precisa de " + Pacote.GB(precisa) + " e só tem " + Pacote.GB(drive.AvailableFreeSpace) + " livre.");
        }

        static void FluxoCapCut(JobDoZip job, Janelinha janela)
        {
            string raiz = Capcut.PastaDosRascunhos();
            if (Capcut.Executavel() == null && !Directory.Exists(raiz))
            {
                janela.Erro("Não achei o CapCut neste PC", "Instale o CapCut (capcut.com) e clique de novo em Projeto editável.");
                return;
            }
            Directory.CreateDirectory(raiz);
            ConferirEspaco(job.ZipPath, job.Pastas, raiz);
            var prontos = new List<string>();
            foreach (var pasta in job.Pastas)
            {
                string nome = Pacote.PastaLivre(raiz, pasta);
                string destino = Path.Combine(raiz, nome);
                janela.Etapa("Copiando pro CapCut", nome);
                Pacote.ExtrairPasta(job.ZipPath, pasta, destino, delegate (string s) { janela.Etapa("Copiando pro CapCut", nome + " — " + s); });
                Capcut.AjustarMeta(destino, raiz);
                prontos.Add(destino);
                Log.Escrever("projeto em " + destino);
            }
            Pacote.ZipPraLixeira(job.ZipPath);
            // só o 1º entra no editor; os outros já vão pra lista com a capa real
            foreach (var outro in prontos.Skip(1)) Capcut.TrocarCapa(outro);

            string principal = prontos[0];
            string nomeP = Path.GetFileName(principal);
            Capcut.Resultado r = Capcut.AbrirProjeto(principal, raiz, delegate (string t, string d) { janela.Etapa(t, d); }, () => janela.Cancelado, janela.SairDaFrente);
            Log.Escrever("resultado: " + r);
            string extra = prontos.Count > 1 ? " (+" + (prontos.Count - 1) + " na lista do CapCut)" : "";
            if (r == Capcut.Resultado.Aberto)
            {
                Capcut.TrocarCapa(principal);
                janela.Pronto("Aberto no CapCut", nomeP + extra);
            }
            else if (r == Capcut.Resultado.NaLista)
            {
                IntPtr h = Capcut.JanelaPrincipal();
                if (h != IntPtr.Zero) Nativo.TrazerPraFrente(h);
                janela.Aviso("O projeto já está no CapCut", "Clique no " + nomeP + " (capa rosa) na tela inicial do CapCut" + extra,
                    Botao("Abrir a pasta", delegate { AbrirPasta(principal); }));
            }
        }

        static void FluxoPremiere(JobDoZip job, Janelinha janela)
        {
            string raiz = Premiere.Raiz;
            Directory.CreateDirectory(raiz);
            ConferirEspaco(job.ZipPath, job.Pastas, raiz);
            var xmls = new List<string>();
            string primeiraPasta = null;
            foreach (var pasta in job.Pastas)
            {
                string nome = Pacote.PastaLivre(raiz, pasta);
                string destino = Path.Combine(raiz, nome);
                janela.Etapa("Copiando o projeto", destino);
                Pacote.ExtrairPasta(job.ZipPath, pasta, destino, delegate (string s) { janela.Etapa("Copiando o projeto", nome + " — " + s); });
                string xml = Premiere.XmlDaPasta(destino);
                if (xml == null) throw new FileNotFoundException("o pacote do Premiere veio sem o .xml");
                Premiere.ApontarXmlPraPasta(xml, Pacote.NomeSeguro(pasta), nome);
                xmls.Add(xml);
                if (primeiraPasta == null) primeiraPasta = destino;
                Log.Escrever("projeto em " + destino);
            }
            Pacote.ZipPraLixeira(job.ZipPath);
            string xmlPrincipal = xmls[0];
            janela.Etapa("Abrindo no Premiere…", "ele leva alguns segundos pra carregar");
            bool abriu = Premiere.Abrir(xmlPrincipal);
            Log.Escrever("premiere: " + (abriu ? "enviado" : "não instalado"));
            if (abriu)
            {
                janela.Pronto("Enviado pro Premiere", "Se ele perguntar, confirme. A mídia está em " + primeiraPasta,
                    Botao("Abrir a pasta", delegate { AbrirPasta(primeiraPasta); }),
                    Botao("Copiar caminho do XML", delegate { CopiarTexto(xmlPrincipal); }));
            }
            else
            {
                janela.Aviso("Não achei o Premiere neste PC", "O projeto está em " + primeiraPasta + ". No Premiere: Arquivo > Importar > o .xml dessa pasta.",
                    Botao("Abrir a pasta", delegate { AbrirPasta(primeiraPasta); }),
                    Botao("Copiar caminho do XML", delegate { CopiarTexto(xmlPrincipal); }));
            }
        }

        static void CopiarTexto(string s)
        {
            var t = new Thread(delegate () { try { Clipboard.SetText(s); } catch { } });
            t.SetApartmentState(ApartmentState.STA);
            t.Start();
            t.Join(2000);
        }
    }
}
