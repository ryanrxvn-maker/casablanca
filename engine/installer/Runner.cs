// =============================================================
//  Auto Edit Downloader - Runner.exe (launcher SILENCIOSO)
//
//  Problema: a task de startup rodava `cmd.exe /c AutoEditDownloader.cmd`,
//  que abre uma JANELA PRETA de console visível no logon (o node server
//  fica rodando dentro dela). Cliente reclamou de ver isso toda vez que
//  liga o PC.
//
//  Solução: este stub winexe (sem console) lança o node server com
//  CreateNoWindow=true + WindowStyle=Hidden + UseShellExecute=false.
//  ZERO janela, zero flash. O processo node roda 100% em background.
//  stdout/stderr são redirecionados pro engine.log.
//
//  ANTI-AV: /target:winexe (GUI app sem console — padrão de qualquer
//  app Windows), sem packer, sem ofuscação. Mesma estratégia do Setup.exe.
//
//  Resolução de paths: tudo relativo à pasta do próprio Runner.exe
//  (que fica em %LOCALAPPDATA%\AutoEditDownloader\).
//
//  Compilar: csc /target:winexe /out:AutoEditRunner.exe Runner.cs
// =============================================================
using System;
using System.Diagnostics;
using System.IO;

class Runner
{
    static void Main()
    {
        try
        {
            // Pasta do próprio exe (= %LOCALAPPDATA%\AutoEditDownloader\)
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;

            string nodeExe   = Path.Combine(baseDir, "node", "node.exe");
            string serverCjs = Path.Combine(baseDir, "server.cjs");
            string binDir    = Path.Combine(baseDir, "bin");
            string ytDlp     = Path.Combine(binDir, "yt-dlp.exe");
            string ffmpeg    = Path.Combine(binDir, "ffmpeg.exe");
            string browsers  = Path.Combine(baseDir, "ms-playwright");
            string logPath   = Path.Combine(baseDir, "engine.log");

            // Se o node ou server não existem, não há o que rodar.
            if (!File.Exists(nodeExe) || !File.Exists(serverCjs))
                return;

            var psi = new ProcessStartInfo
            {
                FileName               = nodeExe,
                Arguments              = "\"" + serverCjs + "\"",
                WorkingDirectory       = baseDir,
                UseShellExecute        = false,   // necessário p/ CreateNoWindow + env vars
                CreateNoWindow         = true,    // ← SEM janela de console
                WindowStyle            = ProcessWindowStyle.Hidden,
                RedirectStandardOutput = true,
                RedirectStandardError  = true,
            };

            // Variáveis de ambiente que o AutoEditDownloader.cmd setava
            psi.EnvironmentVariables["YTDLP_PATH"] = ytDlp;
            psi.EnvironmentVariables["FFMPEG_PATH"] = ffmpeg;
            psi.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = browsers;
            if (psi.EnvironmentVariables["DARKO_ALLOW_ADULT"] == null)
                psi.EnvironmentVariables["DARKO_ALLOW_ADULT"] = "1";

            var proc = new Process { StartInfo = psi };

            // Redireciona saída pro engine.log (append) sem nunca abrir janela.
            var logWriter = new StreamWriter(logPath, append: true) { AutoFlush = true };
            logWriter.WriteLine("[" + DateTime.Now + "] runner start (hidden)");
            proc.OutputDataReceived += (s, e) => { if (e.Data != null) { try { logWriter.WriteLine(e.Data); } catch {} } };
            proc.ErrorDataReceived  += (s, e) => { if (e.Data != null) { try { logWriter.WriteLine(e.Data); } catch {} } };

            proc.Start();
            proc.BeginOutputReadLine();
            proc.BeginErrorReadLine();

            // O Runner espera o node terminar (mantém o redirect de log vivo).
            // Como é winexe sem janela, isso NÃO mostra nada na tela —
            // só segura o processo pai em background.
            proc.WaitForExit();

            logWriter.WriteLine("[" + DateTime.Now + "] node exit code " + proc.ExitCode);
            logWriter.Dispose();
        }
        catch
        {
            // Silencioso por definição — nunca mostra erro ao cliente.
        }
    }
}
