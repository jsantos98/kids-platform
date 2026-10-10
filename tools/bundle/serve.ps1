# Kids Platform - a tiny local web server for the built game (the game needs
# http://, not file://). Uses only what Windows ships with: Windows PowerShell
# 5.1 and its built-in C# compiler. Started by start.bat; close the window to stop.
param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'

$root = Join-Path $PSScriptRoot 'game'
if (-not (Test-Path (Join-Path $root 'index.html'))) {
    Write-Host 'The "game" folder is missing next to this file. Unzip the whole package and start again.'
    exit 1
}
$version = ''
$versionFile = Join-Path $PSScriptRoot 'VERSION.txt'
if (Test-Path $versionFile) { $version = (Get-Content $versionFile -TotalCount 1) }

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Net;
using System.Threading;

public class StaticServer
{
    private HttpListener listener;
    private string root;
    private int port;

    private static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
    {
        { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" }, { ".mjs", "text/javascript; charset=utf-8" },
        { ".css", "text/css; charset=utf-8" }, { ".json", "application/json; charset=utf-8" }, { ".map", "application/json" },
        { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".webp", "image/webp" },
        { ".svg", "image/svg+xml" }, { ".ico", "image/x-icon" },
        { ".glb", "model/gltf-binary" }, { ".gltf", "model/gltf+json" }, { ".bin", "application/octet-stream" },
        { ".ogg", "audio/ogg" }, { ".mp3", "audio/mpeg" }, { ".wav", "audio/wav" },
        { ".wasm", "application/wasm" }, { ".woff", "font/woff" }, { ".woff2", "font/woff2" }, { ".txt", "text/plain; charset=utf-8" }
    };

    public StaticServer(string root, int port)
    {
        this.root = Path.GetFullPath(root).TrimEnd('\\') + "\\";
        this.port = port;
    }

    public int Port { get { return port; } }

    // binds the port (throws if it is taken)
    public void Start()
    {
        listener = new HttpListener();
        listener.Prefixes.Add("http://localhost:" + port + "/");
        listener.Prefixes.Add("http://127.0.0.1:" + port + "/");
        listener.Start();
    }

    // serves until the window is closed; every request on its own thread (the
    // game fetches dozens of models and sounds at once)
    public void Run()
    {
        while (listener.IsListening)
        {
            HttpListenerContext ctx;
            try { ctx = listener.GetContext(); }
            catch (Exception) { break; }
            ThreadPool.QueueUserWorkItem(delegate(object o) { Handle((HttpListenerContext)o); }, ctx);
        }
    }

    private static void Fail(HttpListenerContext ctx, int code)
    {
        ctx.Response.StatusCode = code;
    }

    private void Handle(HttpListenerContext ctx)
    {
        try
        {
            string rel = Uri.UnescapeDataString(ctx.Request.Url.AbsolutePath).Replace('/', '\\').TrimStart('\\');
            string path = Path.GetFullPath(Path.Combine(root, rel));
            if (!path.StartsWith(root, StringComparison.OrdinalIgnoreCase)) { Fail(ctx, 403); return; }
            if (Directory.Exists(path)) path = Path.Combine(path, "index.html");
            if (!File.Exists(path))
            {
                Console.WriteLine("404 " + ctx.Request.Url.AbsolutePath);
                Fail(ctx, 404);
                return;
            }
            FileInfo fi = new FileInfo(path);
            DateTime lm = fi.LastWriteTimeUtc;
            lm = new DateTime(lm.Year, lm.Month, lm.Day, lm.Hour, lm.Minute, lm.Second, DateTimeKind.Utc);
            string type;
            if (!Types.TryGetValue(Path.GetExtension(path), out type)) type = "application/octet-stream";
            ctx.Response.ContentType = type;
            ctx.Response.Headers["Cache-Control"] = "no-cache";
            ctx.Response.Headers["Last-Modified"] = lm.ToString("r", CultureInfo.InvariantCulture);
            string ims = ctx.Request.Headers["If-Modified-Since"];
            DateTime since;
            if (ims != null && DateTime.TryParse(ims, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal, out since) && since >= lm)
            {
                Fail(ctx, 304);
                return;
            }
            ctx.Response.ContentLength64 = fi.Length;
            if (ctx.Request.HttpMethod != "HEAD")
            {
                using (FileStream fs = File.OpenRead(path)) fs.CopyTo(ctx.Response.OutputStream);
            }
        }
        catch (Exception)
        {
            // (the browser closed the connection, or a path that isn't one)
            try { ctx.Response.StatusCode = 400; } catch (Exception) { }
        }
        finally
        {
            try { ctx.Response.OutputStream.Close(); } catch (Exception) { }
        }
    }
}
'@

# the first free port from 8321 (a second copy running, or another program, may hold it)
$server = $null
foreach ($port in 8321..8340) {
    try {
        $candidate = New-Object StaticServer($root, $port)
        $candidate.Start()
        $server = $candidate
        break
    } catch { }
}
if ($null -eq $server) {
    Write-Host 'Could not open a local port (8321-8340 are all busy). Close other programs and try again.'
    exit 1
}

$url = 'http://localhost:' + $server.Port + '/'
Write-Host ''
Write-Host "  $version"
Write-Host "  The game is running at $url"
Write-Host '  Leave this window open while playing. Close it to stop the game.'
Write-Host ''
if (-not $NoBrowser) { Start-Process $url }
$server.Run()
