// Executable regression checks for the production installer completion protocol.
// Time and health are explicit inputs so races are reproducible without sleeps.
using System;
using System.IO;
namespace AutoEdit
{
    static class InstallerCompletionTests
    {
        static int _passed;
        static readonly DateTime T = new DateTime(2026, 9, 12, 18, 0, 0, DateTimeKind.Utc);
        static readonly EngineHealthResult Healthy = new EngineHealthResult(true, "Motor 1.2.1 online");
        static readonly EngineHealthResult Old = new EngineHealthResult(false, "Foi encontrado Motor 1.2.0; esperado 1.2.1.");
        static void Assert(bool ok, string name) { if (!ok) throw new Exception(name); }
        static void Check(string name, Action run) { run(); _passed++; Console.WriteLine("PASS " + name); }
        static void State(InstallerDecision result, InstallerCompletionState expected) { Assert(result.State == expected, "Expected " + expected + ", got " + result.State + ": " + result.Message); }
        static int Main()
        {
            try
            {
                Check("DONE plus exit0 in same UI tick is success only with verified engine", delegate
                {
                    State(new InstallerCompletion().Observe("DONE|ok", true, 0, true, Healthy, T), InstallerCompletionState.Success);
                });
                Check("DONE alone cannot declare success while PowerShell still runs", delegate
                {
                    var c = new InstallerCompletion();
                    State(c.Observe("DONE|ok", false, 0, true, Healthy, T), InstallerCompletionState.WaitingForExit);
                    State(c.Observe(null, true, 0, true, Healthy, T.AddMilliseconds(150)), InstallerCompletionState.Success);
                });
                Check("exit0 before final status read tolerates delayed atomic DONE", delegate
                {
                    var c = new InstallerCompletion();
                    State(c.Observe("97|Iniciando", true, 0, true, null, T), InstallerCompletionState.WaitingForStatus);
                    State(c.Observe("DONE|ok", true, 0, true, Healthy, T.AddMilliseconds(300)), InstallerCompletionState.Success);
                });
                Check("file temporarily absent after DONE does not discard terminal evidence", delegate
                {
                    var c = new InstallerCompletion(); c.Observe("DONE|ok", false, 0, true, null, T);
                    State(c.Observe(null, true, 0, true, Healthy, T.AddMilliseconds(150)), InstallerCompletionState.Success);
                });
                Check("100 percent progress plus exit0 does not substitute DONE", delegate
                {
                    var c = new InstallerCompletion(); c.Observe("100|Motor online", true, 0, true, Healthy, T);
                    var r = c.Observe("100|Motor online", true, 0, true, Healthy, T.AddSeconds(3));
                    State(r, InstallerCompletionState.Failure); Assert(r.ExitCode != 0, "missing DONE cannot exit0");
                });
                Check("exit0 with no confirmation becomes actionable failure after bounded grace", delegate
                {
                    var c = new InstallerCompletion(); c.Observe(null, true, 0, true, Healthy, T);
                    var r = c.Observe(null, true, 0, true, Healthy, T.AddSeconds(4));
                    State(r, InstallerCompletionState.Failure); Assert(r.Message.Contains("sem confirmar"), "precise missing status error");
                });
                Check("ERR text survives nonzero process exit", delegate
                {
                    var r = new InstallerCompletion().Observe("ERR|Falha copiando server.cjs: acesso negado.", true, 50, true, Healthy, T);
                    State(r, InstallerCompletionState.Failure); Assert(r.Message.Contains("server.cjs"), "specific error lost"); Assert(r.ExitCode == 50, "error code lost");
                });
                Check("ERR remains failure even with process exit0 and healthy engine", delegate
                {
                    var r = new InstallerCompletion().Observe("ERR|Falha preparando componente", true, 0, true, Healthy, T);
                    State(r, InstallerCompletionState.Failure); Assert(r.ExitCode != 0, "ERR cannot become success");
                });
                Check("DONE cannot hide nonzero exit status", delegate
                {
                    var r = new InstallerCompletion().Observe("DONE|ok", true, 17, true, Healthy, T);
                    State(r, InstallerCompletionState.Failure); Assert(r.Message.Contains("17"), "nonzero exit missing");
                });
                Check("asynchronous stderr and final ERR are drained before generic exit failure", delegate
                {
                    var c = new InstallerCompletion();
                    State(c.Observe(null, true, 9, false, null, T), InstallerCompletionState.WaitingForOutput);
                    var r = c.Observe("ERR|Falha concreta no arquivo", true, 9, true, null, T.AddMilliseconds(150));
                    State(r, InstallerCompletionState.Failure); Assert(r.Message.Contains("Falha concreta"), "late error discarded");
                });
                Check("successful status waits for output drain before health completion", delegate
                {
                    var c = new InstallerCompletion();
                    State(c.Observe("DONE|ok", true, 0, false, Healthy, T), InstallerCompletionState.WaitingForOutput);
                    State(c.Observe(null, true, 0, true, Healthy, T.AddMilliseconds(150)), InstallerCompletionState.Success);
                });
                Check("inherited open pipes cannot hang completion forever", delegate
                {
                    var c = new InstallerCompletion(); c.Observe("DONE|ok", true, 0, false, Healthy, T);
                    State(c.Observe(null, true, 0, false, Healthy, T.AddSeconds(2)), InstallerCompletionState.Success);
                });
                Check("healthy result is mandatory and transient startup can recover", delegate
                {
                    var c = new InstallerCompletion();
                    State(c.Observe("DONE|ok", true, 0, true, null, T), InstallerCompletionState.Verifying);
                    State(c.Observe(null, true, 0, true, Old, T.AddSeconds(10)), InstallerCompletionState.Verifying);
                    State(c.Observe(null, true, 0, true, Healthy, T.AddSeconds(20)), InstallerCompletionState.Success);
                });
                Check("old engine cannot satisfy a successful installation", delegate
                {
                    var c = new InstallerCompletion(); c.Observe("DONE|ok", true, 0, true, Old, T);
                    var r = c.Observe(null, true, 0, true, Old, T.AddSeconds(30));
                    State(r, InstallerCompletionState.Failure); Assert(r.Message.Contains("1.2.0"), "observed engine version missing");
                });
                Check("missing health result reaches bounded terminal failure", delegate
                {
                    var c = new InstallerCompletion(); c.Observe("DONE|ok", true, 0, true, null, T);
                    State(c.Observe(null, true, 0, true, null, T.AddSeconds(30)), InstallerCompletionState.Failure);
                });
                Check("DONE with process that never exits reaches bounded failure", delegate
                {
                    var c = new InstallerCompletion(); c.Observe("DONE|ok", false, 0, true, Healthy, T);
                    State(c.Observe(null, false, 0, true, Healthy, T.AddSeconds(31)), InstallerCompletionState.Failure);
                });
                Check("UTF8 BOM and pipe characters in errors retain protocol meaning", delegate
                {
                    State(new InstallerCompletion().Observe("\uFEFFDONE|ok", true, 0, true, Healthy, T), InstallerCompletionState.Success);
                    var r = new InstallerCompletion().Observe("ERR|arquivo|com detalhe", true, 2, true, null, T);
                    Assert(r.Message == "arquivo|com detalhe", "error pipe contents truncated");
                });
                Check("final result is stable across later redundant ticks", delegate
                {
                    var c = new InstallerCompletion(); var first = c.Observe("ERR|falha", true, 1, true, Healthy, T);
                    Assert(object.ReferenceEquals(first, c.Observe("DONE|ok", true, 0, true, Healthy, T.AddSeconds(10))), "terminal result changed");
                });
#if !REMOVER
                Check("missing or malformed release metadata cannot prove engine version", delegate
                {
                    string dir = Path.Combine(Path.GetTempPath(), "AutoEditCompletionTest-" + Guid.NewGuid().ToString("N"));
                    Directory.CreateDirectory(dir);
                    try
                    {
                        Assert(!InstallerEngineHealth.Check(dir).Healthy, "metadata missing accepted");
                        File.WriteAllText(Path.Combine(dir, "engine-version.txt"), "unknown");
                        Assert(!InstallerEngineHealth.Check(dir).Healthy, "invalid metadata accepted");
                    }
                    finally { Directory.Delete(dir, true); }
                });
#endif
                Console.WriteLine(_passed + " installer completion checks passed."); return 0;
            }
            catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
        }
    }
}
