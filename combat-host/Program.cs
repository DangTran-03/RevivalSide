using System.Text.Json;
using System.Text.Json.Serialization;
using RevivalSide.CombatHost;

if (args.Contains("--stdio"))
{
    string? line;
    while ((line = Console.In.ReadLine()) != null)
    {
        Write(Process(line));
        Console.Out.WriteLine();
        Console.Out.Flush();
    }
    return;
}

var input = Console.In.ReadToEnd();
Write(Process(input));

static HostResponse Process(string input)
{
    if (string.IsNullOrWhiteSpace(input))
    {
        return new HostResponse { Ok = false, Error = "empty request" };
    }

    try
    {
        var request = JsonSerializer.Deserialize<HostRequest>(input, Json.Options);
        if (request == null || string.IsNullOrWhiteSpace(request.Command))
        {
            return new HostResponse { Ok = false, Error = "invalid request" };
        }

        var engine = new CombatEngine(request.Options ?? new HostOptions());
        return engine.Handle(request);
    }
    catch (Exception ex)
    {
        return new HostResponse { Ok = false, Error = ex.ToString() };
    }
}

static void Write(HostResponse response)
{
    Console.Out.Write(JsonSerializer.Serialize(response, Json.Options));
}

namespace RevivalSide.CombatHost
{
    internal static class Json
    {
        public static readonly JsonSerializerOptions Options = new()
        {
            PropertyNameCaseInsensitive = true,
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            DictionaryKeyPolicy = JsonNamingPolicy.CamelCase,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
            NumberHandling = JsonNumberHandling.AllowReadingFromString
        };
    }
}
