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
using System.Security.Cryptography;
using System.Text;
using System.Threading;

class Runner
{
    static void Main()
    {
        string baseDir = Path.GetFullPath(AppDomain.CurrentDomain.BaseDirectory);
        string logPath = Path.Combine(baseDir, "engine.log");
        try
        {
            string identity;
            using (var hash = SHA256.Create())
                identity = BitConverter.ToString(hash.ComputeHash(
                    Encoding.UTF8.GetBytes(baseDir.ToLowerInvariant()))).Replace("-", "");
            using (var gate = new Mutex(false, "Local\\AutoEditDownloader." + identity))
            {
                bool ownsGate;
                try { ownsGate = gate.WaitOne(0); }
                catch (AbandonedMutexException) { ownsGate = true; }
                if (!ownsGate) return;
                try { Supervise(baseDir, logPath); }
                finally { gate.ReleaseMutex(); }
            }
        }
        catch (Exception error)
        {
            try { File.AppendAllText(logPath, "[" + DateTime.Now + "] runner error: " + error.Message + Environment.NewLine); }
            catch { }
        }
    }

    static void Supervise(string baseDir, string logPath)
    {
        string nodeExe = Path.Combine(baseDir, "node", "node.exe");
        string serverCjs = Path.Combine(baseDir, "server.cjs");
        if (!File.Exists(nodeExe) || !File.Exists(serverCjs))
            throw new FileNotFoundException("Motor incompleto. Execute o instalador do Downloader para reparar.");

        try
        {
            if (File.Exists(logPath) && new FileInfo(logPath).Length > 5 * 1024 * 1024)
            {
                File.Delete(logPath + ".previous");
                File.Move(logPath, logPath + ".previous");
            }
        }
        catch { }

        using (TextWriter log = TextWriter.Synchronized(new StreamWriter(logPath, true) { AutoFlush = true }))
        {
            int delaySeconds = 2;
            for (;;)
            {
                var startedAt = DateTime.UtcNow;
                int exitCode = -1;
                try
                {
                    var psi = new ProcessStartInfo
                    {
                        FileName = nodeExe,
                        Arguments = "\"" + serverCjs + "\"",
                        WorkingDirectory = baseDir,
                        UseShellExecute = false,
                        CreateNoWindow = true,
                        WindowStyle = ProcessWindowStyle.Hidden,
                        RedirectStandardOutput = true,
                        RedirectStandardError = true,
                    };
                    psi.EnvironmentVariables["YTDLP_PATH"] = Path.Combine(baseDir, "bin", "yt-dlp.exe");
                    psi.EnvironmentVariables["FFMPEG_PATH"] = Path.Combine(baseDir, "bin", "ffmpeg.exe");
                    psi.EnvironmentVariables["PLAYWRIGHT_BROWSERS_PATH"] = Path.Combine(baseDir, "ms-playwright");
                    if (psi.EnvironmentVariables["DARKO_ALLOW_ADULT"] == null)
                        psi.EnvironmentVariables["DARKO_ALLOW_ADULT"] = "1";
                    using (var proc = new Process { StartInfo = psi })
                    {
                        proc.OutputDataReceived += (s, e) => { if (e.Data != null) { try { log.WriteLine(e.Data); } catch { } } };
                        proc.ErrorDataReceived += (s, e) => { if (e.Data != null) { try { log.WriteLine(e.Data); } catch { } } };
                        log.WriteLine("[" + DateTime.Now + "] runner start (hidden)");
                        proc.Start();
                        proc.BeginOutputReadLine();
                        proc.BeginErrorReadLine();
                        proc.WaitForExit();
                        exitCode = proc.ExitCode;
                    }
                }
                catch (Exception error) { log.WriteLine("[" + DateTime.Now + "] node start failed: " + error.Message); }

                log.WriteLine("[" + DateTime.Now + "] node exit code " + exitCode);
                // Exit 0 is deliberate, including an already-running engine.
                if (exitCode == 0) return;
                if ((DateTime.UtcNow - startedAt).TotalMinutes >= 5) delaySeconds = 2;
                log.WriteLine("[" + DateTime.Now + "] restarting engine in " + delaySeconds + "s");
                Thread.Sleep(delaySeconds * 1000);
                delaySeconds = Math.Min(60, delaySeconds * 2);
            }
        }
    }
}
