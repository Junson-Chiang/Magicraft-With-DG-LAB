using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Newtonsoft.Json;

namespace MagicraftEvents
{
    internal sealed class EventSink : IDisposable
    {
        private readonly BlockingCollection<string> queue = new BlockingCollection<string>(1024);
        private readonly Thread worker;
        private readonly Action<string> warn;
        private readonly string session = Guid.NewGuid().ToString("N");
        private readonly string path;
        private readonly bool udpEnabled;
        private readonly bool fileEnabled;
        private readonly int port;
        private long sequence;
        private long dropped;
        private int closed;
        public EventSink(string root, bool udp, int udpPort, bool file, Action<string> warning)
        {
            warn = warning;
            udpEnabled = udp && udpPort > 0 && udpPort <= 65535;
            port = udpPort;
            fileEnabled = file;
            path = Path.Combine(root, "MagicraftEvents", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + session + ".jsonl");
            worker = new Thread(Run) { IsBackground = true, Name = "Magicraft event output" };
            worker.Start();
        }
        public void Publish(string name, Dictionary<string, object> data)
        {
            if (Volatile.Read(ref closed) != 0) return;
            var frame = new Dictionary<string, object> {
                { "schemaVersion", 1 }, { "source", "magicraft" }, { "sessionId", session },
                { "sequence", Interlocked.Increment(ref sequence) }, { "timestampUtc", DateTime.UtcNow.ToString("o") },
                { "event", name }, { "droppedEvents", Interlocked.Read(ref dropped) }, { "data", data }
            };
            var json = JsonConvert.SerializeObject(frame);
            try { if (!queue.TryAdd(json)) Interlocked.Increment(ref dropped); }
            catch (InvalidOperationException) { }
        }
        private void Run()
        {
            StreamWriter writer = null;
            UdpClient udp = null;
            try
            {
                if (fileEnabled) try {
                    Directory.CreateDirectory(Path.GetDirectoryName(path));
                    writer = new StreamWriter(path, false, new UTF8Encoding(false)) { AutoFlush = true };
                } catch (Exception ex) { warn("JSONL output disabled: " + ex.Message); }
                if (udpEnabled) try { udp = new UdpClient(); udp.Connect(IPAddress.Loopback, port); }
                    catch (Exception ex) { warn("UDP output disabled: " + ex.Message); if (udp != null) udp.Close(); udp = null; }
                bool udpError = false;
                foreach (var json in queue.GetConsumingEnumerable())
                {
                    if (writer != null) try { writer.WriteLine(json); }
                        catch (Exception ex) { warn("JSONL output failed: " + ex.Message); writer.Dispose(); writer = null; }
                    if (udp != null) try { var bytes = Encoding.UTF8.GetBytes(json); udp.Send(bytes, bytes.Length); udpError = false; }
                        catch (Exception ex) { if (!udpError) warn("UDP output failed: " + ex.Message); udpError = true; }
                }
            }
            catch (Exception ex) { warn("Output worker stopped: " + ex.Message); }
            finally { if (writer != null) writer.Dispose(); if (udp != null) udp.Close(); }
        }
        public void Dispose()
        {
            if (Interlocked.Exchange(ref closed, 1) != 0) return;
            queue.CompleteAdding();
            if (!worker.Join(2000)) warn("Event output still draining during shutdown.");
        }
    }
}
