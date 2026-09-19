// In-process WinForms integration test. No native UI automation or window
// interaction: tests invoke the actual form's timer handler and inspect state.
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Linq.Expressions;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

class InstallerSmoke
{
    const BindingFlags PrivateInstance = BindingFlags.NonPublic | BindingFlags.Public | BindingFlags.Instance;
    static Type FormType;
    static string Artifacts;
    static string Extraction;
    static string InstallerPath;

    static void Assert(bool condition, string message)
    {
        if (!condition) throw new Exception(message);
    }

    static object Read(Form form, string field)
    {
        var member = FormType.GetField(field, PrivateInstance);
        if (member == null) throw new Exception("Missing test field: " + field);
        return member.GetValue(form);
    }

    static void Set(Form form, string field, object value)
    {
        FormType.GetField(field, PrivateInstance).SetValue(form, value);
    }

    static void Tick(Form form)
    {
        FormType.GetMethod("OnTick", PrivateInstance).Invoke(form, new object[] { null, EventArgs.Empty });
        Application.DoEvents();
    }

    static string LabelText(Form form, string field)
    {
        return ((Label)Read(form, field)).Text;
    }

    static int ResultCode(Form form)
    {
        var property = FormType.GetProperty("ResultCode", PrivateInstance);
        Assert(property != null, "Installer does not expose the verified terminal result.");
        return (int)property.GetValue(form, null);
    }

    static void AssertOutcome(Form form, bool success, string message)
    {
        Assert((bool)Read(form, "_finished"), "Outcome is not terminal.");
        Assert((ResultCode(form) == 0) == success, message + " / " + LabelText(form, "_statusLbl") + " / " + LabelText(form, "_hintLbl"));
        var completion = Read(form, "_completion");
        var final = completion.GetType().GetField("_final", PrivateInstance).GetValue(completion);
        Assert(final != null, "Completion reducer has no final decision.");
        string state = final.GetType().GetField("State", PrivateInstance).GetValue(final).ToString();
        Assert(state == (success ? "Success" : "Failure"), "Reducer state disagrees with exit code: " + state);
    }

    static Form NewForm(string status, bool? simulatedHealth, string detail)
    {
        object[] arguments = new object[] { Extraction, status };
        var healthType = FormType.Assembly.GetType("AutoEdit.EngineHealthResult");
        if (simulatedHealth.HasValue && healthType != null)
        {
            object health = Activator.CreateInstance(healthType, new object[] { simulatedHealth.Value, detail ?? "fixture healthy" });
            Type probeType = typeof(Func<>).MakeGenericType(healthType);
            Delegate probe = Expression.Lambda(probeType, Expression.Constant(health, healthType)).Compile();
            arguments = new object[] { Extraction, status, probe };
        }
        var form = (Form)Activator.CreateInstance(FormType, PrivateInstance, null,
            arguments, null);
        // Create a handle for real WinForms dispatch, without Show/Application.Run.
        var handle = form.Handle;
        form.PerformLayout();
        return form;
    }

    static void SetExitedProcess(Form form, Process process)
    {
        Set(form, "_psProc", process);
        foreach (string name in new string[] { "_stdoutClosed", "_stderrClosed" })
        {
            var field = FormType.GetField(name, PrivateInstance);
            if (field != null) field.SetValue(form, true);
        }
    }

    static Process EndedProcess(int code)
    {
        var process = Process.Start(new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "WindowsPowerShell", "v1.0", "powershell.exe"),
            Arguments = "-NoProfile -NonInteractive -Command \"exit " + code + "\"",
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
        });
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        Assert(process.WaitForExit(10000), "Fixture PowerShell did not finish.");
        process.WaitForExit();
        Assert(process.ExitCode == code, "Unexpected fixture exit code.");
        return process;
    }

    static void WaitFinished(Form form, int milliseconds)
    {
        var until = DateTime.UtcNow.AddMilliseconds(milliseconds);
        while (DateTime.UtcNow < until)
        {
            Tick(form);
            if ((bool)Read(form, "_finished")) return;
            Thread.Sleep(100);
        }
        throw new Exception("Form never finished: " + LabelText(form, "_statusLbl") + " / " + LabelText(form, "_hintLbl"));
    }

    static void Render(Form form, string filename)
    {
        using (var bitmap = new Bitmap(form.Width, form.Height))
        {
            form.DrawToBitmap(bitmap, new Rectangle(Point.Empty, form.Size));
            // A never-shown form suppresses child WM_PRINT dispatch. Ask each
            // actual child control to draw itself into the same surface.
            foreach (Control control in form.Controls)
            {
                if (control.Width > 0 && control.Height > 0)
                    control.DrawToBitmap(bitmap, new Rectangle(control.Location, control.Size));
            }
            bitmap.Save(Path.Combine(Artifacts, filename));
        }
    }

    static void RaceFixtures()
    {
        string status = Path.Combine(Artifacts, "race-status.txt");
        File.WriteAllText(status, "DONE|ok");
        using (var form = NewForm(status, true, "fixture healthy"))
        using (var process = EndedProcess(0))
        {
            SetExitedProcess(form, process);
            WaitFinished(form, 40000);
            Render(form, "done-exit-zero.png");
            AssertOutcome(form, true, "DONE + exit 0 was not success");
            Assert(LabelText(form, "_statusLbl") == "Instalação concluída", "Wrong success heading.");
            Console.WriteLine("PASS DONE + real exited PowerShell 0 + engine health => success");
        }

        File.WriteAllText(status, "ERR|O componente de download nao passou na verificacao.");
        using (var form = NewForm(status, true, "fixture healthy"))
        using (var process = EndedProcess(50))
        {
            SetExitedProcess(form, process);
            WaitFinished(form, 40000);
            Assert(LabelText(form, "_hintLbl").Contains("componente de download"),
                "Structured installer error was discarded: " + LabelText(form, "_hintLbl"));
            AssertOutcome(form, false, "ERR cannot become success.");
            Render(form, "structured-error.png");
            Console.WriteLine("PASS ERR + exited PowerShell retains specific installer error");
        }

        File.WriteAllText(status, "DONE|ok");
        using (var form = NewForm(status, true, "fixture healthy"))
        using (var process = EndedProcess(17))
        {
            SetExitedProcess(form, process);
            WaitFinished(form, 40000);
            AssertOutcome(form, false, "DONE cannot mask nonzero process exit.");
            Assert(ResultCode(form) == 17, "Original failure exit code was lost.");
            Assert(LabelText(form, "_hintLbl").Contains("17"), "Nonzero exit diagnostic was lost.");
            Render(form, "done-exit-seventeen.png");
            Console.WriteLine("PASS DONE + exit 17 cannot produce false success");
        }

        File.WriteAllText(status, "100|Motor online");
        using (var form = NewForm(status, true, "fixture healthy"))
        using (var process = EndedProcess(0))
        {
            SetExitedProcess(form, process);
            WaitFinished(form, 40000);
            AssertOutcome(form, false, "Exit 0 without DONE cannot produce false success.");
            Render(form, "missing-done.png");
            Console.WriteLine("PASS exit 0 without terminal DONE does not declare success");
        }

        File.WriteAllText(status, "DONE|ok");
        using (var form = NewForm(status, false, "Motor antigo 1.1.0, atualizacao nao foi aplicada."))
        using (var process = EndedProcess(0))
        {
            SetExitedProcess(form, process);
            WaitFinished(form, 40000);
            AssertOutcome(form, false, "Incompatible health cannot produce false success.");
            Assert(LabelText(form, "_hintLbl").Contains("1.1.0"), "Incompatible engine diagnostic was lost.");
            Render(form, "incompatible-health.png");
            Console.WriteLine("PASS DONE + exit 0 + incompatible engine remains failure");
        }
    }

    static void Install()
    {
        string installerVersion = FileVersionInfo.GetVersionInfo(InstallerPath).FileVersion;
        Assert(installerVersion == "3.1.1.0", "Expected installer hotfix 3.1.1.0, got " + installerVersion);
        string expectedVersion = File.ReadAllText(Path.Combine(Extraction, "engine-version.txt")).Trim();
        Assert(expectedVersion == "1.2.1", "Embedded engine version marker is wrong.");
        string status = Path.Combine(Artifacts, "live-status.txt");
        File.WriteAllText(status, "2|Preparando");
        using (var form = NewForm(status, null, null))
        {
            FormType.GetMethod("LaunchPowerShell", PrivateInstance).Invoke(form, null);
            WaitFinished(form, 20 * 60 * 1000);
            Render(form, "live-install.png");
            string heading = LabelText(form, "_statusLbl");
            string detail = LabelText(form, "_hintLbl");
            AssertOutcome(form, true, "Embedded real installer did not succeed");
            Assert(heading == "Instalação concluída", "Wrong live success heading.");
            var process = (Process)Read(form, "_psProc");
            Assert(process.HasExited && process.ExitCode == 0, "Success UI requires an actual clean installer exit.");
            string health = null;
            for (int port = 47923; port <= 47931; port++)
            {
                try
                {
                    using (var client = new WebClient())
                    {
                        string body = client.DownloadString("http://127.0.0.1:" + port + "/health");
                        if (body.Contains("darkolab-downloader-engine") && body.Contains("\"version\":\"" + expectedVersion + "\"") && body.Contains("download-jobs-v1"))
                        { health = body; break; }
                    }
                }
                catch { }
            }
            Assert(health != null, "Independent engine health/version/capability check failed after UI success.");
            File.WriteAllText(Path.Combine(Artifacts, "live-result.txt"),
                "Installer=" + installerVersion + "\r\nPowerShellExitCode=" + process.ExitCode + "\r\nStatus=" + File.ReadAllText(status).Trim() +
                "\r\nUI=" + heading + "\r\nDetail=" + detail + "\r\nHealth=" + health);
            Console.WriteLine("PASS actual EXE embedded package -> actual installer PowerShell -> actual engine -> WinForms success");
        }
    }

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            Assert(args.Length >= 2, "Usage: InstallerSmoke.exe <installer-exe> <artifact-directory> [--install]");
            Artifacts = Path.GetFullPath(args[1]);
            Directory.CreateDirectory(Artifacts);
            Extraction = Path.Combine(Artifacts, "embedded-package");
            Directory.CreateDirectory(Extraction);
            InstallerPath = Path.GetFullPath(args[0]);
            var assembly = Assembly.LoadFrom(InstallerPath);
            FormType = assembly.GetType("AutoEdit.InstallerForm", true);
            string resourceName = null;
            foreach (string resource in assembly.GetManifestResourceNames())
                if (resource.EndsWith("pkg.zip", StringComparison.OrdinalIgnoreCase)) resourceName = resource;
            Assert(resourceName != null, "Installer EXE has no embedded package.");
            var zip = Path.Combine(Artifacts, "embedded.zip");
            using (var input = assembly.GetManifestResourceStream(resourceName))
            using (var output = File.Create(zip)) input.CopyTo(output);
            ZipFile.ExtractToDirectory(zip, Extraction);
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (args.Length > 2 && args[2] == "--install") Install();
            else RaceFixtures();
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
    }
}
