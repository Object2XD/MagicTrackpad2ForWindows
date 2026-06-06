using Microsoft.Win32;
using Microsoft.Win32.SafeHandles;
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

namespace AmtPtpControlBridge
{
    internal static class Program
    {
        private static readonly JavaScriptSerializer Json = new JavaScriptSerializer();

        private static int Main(string[] args)
        {
            string command = args.Length > 0 ? args[0] : "";

            try
            {
                object response;
                switch (command)
                {
                    case "read-settings":
                        response = RegistrySettings.ToResponse(RegistrySettings.Read(), command);
                        break;
                    case "write-settings":
                        response = WriteSettings(command, args, apply: false);
                        break;
                    case "apply-settings":
                        response = WriteSettings(command, args, apply: true);
                        break;
                    case "get-battery":
                        response = GetBattery(command);
                        break;
                    case "open-touchpad-settings":
                        response = OpenTouchpadSettings(command);
                        break;
                    case "":
                    case "help":
                    case "--help":
                    case "-h":
                        response = Help(command);
                        break;
                    default:
                        return WriteJson(Error(command, "unknown-command", "Unknown command: " + command, 64), 64);
                }

                return WriteJson(response, 0);
            }
            catch (ValidationException ex)
            {
                return WriteJson(Error(command, ex.Code, ex.Message, 2), 2);
            }
            catch (Exception ex)
            {
                return WriteJson(Error(command, "unhandled-error", ex.ToString(), 1), 1);
            }
        }

        private static object WriteSettings(string command, string[] args, bool apply)
        {
            string payload = ReadPayload(args);
            Settings settings = Settings.FromJson(payload);
            RawSettings raw = RegistrySettings.ToRaw(settings);
            RegistrySettings.Save(raw);

            var result = new Dictionary<string, object>
            {
                { "ok", true },
                { "command", command },
                { "settings", RegistrySettings.FromRaw(raw).ToDictionary() },
                { "registry", raw.ToDictionary() }
            };

            if (apply)
            {
                bool usbRestarted = UsbDevice.RestartDevices();
                bool bluetoothReloaded = BtDevice.SendIoctl(BtDevice.IOCTL_RELOAD_SETTINGS, out int bluetoothError);
                result["usbRestarted"] = usbRestarted;
                result["bluetoothReloaded"] = bluetoothReloaded;
                result["bluetoothError"] = bluetoothReloaded ? null : (object)bluetoothError;
            }

            return result;
        }

        private static string ReadPayload(string[] args)
        {
            if (args.Length > 1)
                return args[1];

            string stdin = Console.In.ReadToEnd();
            if (string.IsNullOrWhiteSpace(stdin))
                throw new ValidationException("missing-json", "A JSON settings payload is required.");

            return stdin;
        }

        private static object GetBattery(string command)
        {
            uint level;
            int error;
            bool ioctlSucceeded = BtDevice.SendIoctl(BtDevice.IOCTL_GET_BATTERY, out level, out error);

            return new Dictionary<string, object>
            {
                { "ok", ioctlSucceeded && level <= 100 },
                { "command", command },
                { "ioctlSucceeded", ioctlSucceeded },
                { "level", ioctlSucceeded ? (object)level : null },
                { "validLevel", ioctlSucceeded && level <= 100 },
                { "error", ioctlSucceeded ? null : (object)error }
            };
        }

        private static object OpenTouchpadSettings(string command)
        {
            Process.Start("ms-settings:devices-touchpad");
            return new Dictionary<string, object>
            {
                { "ok", true },
                { "command", command }
            };
        }

        private static object Help(string command)
        {
            return new Dictionary<string, object>
            {
                { "ok", true },
                { "command", command },
                { "commands", new[] { "read-settings", "write-settings", "apply-settings", "get-battery", "open-touchpad-settings" } }
            };
        }

        private static object Error(string command, string code, string message, int exitCode)
        {
            return new Dictionary<string, object>
            {
                { "ok", false },
                { "command", command },
                { "error", new Dictionary<string, object>
                    {
                        { "code", code },
                        { "message", message }
                    }
                },
                { "exitCode", exitCode }
            };
        }

        private static int WriteJson(object value, int exitCode)
        {
            Console.Out.WriteLine(Json.Serialize(value));
            return exitCode;
        }

        private static Dictionary<string, object> ParseObject(string json)
        {
            try
            {
                var obj = Json.DeserializeObject(json) as Dictionary<string, object>;
                if (obj == null)
                    throw new ValidationException("invalid-json", "JSON payload must be an object.");
                return obj;
            }
            catch (ArgumentException ex)
            {
                throw new ValidationException("invalid-json", ex.Message);
            }
        }

        private sealed class Settings
        {
            public string ClickMode = "macos";
            public int FeedbackLevel = 1;
            public bool SilentClicking;
            public string StopMode = "pressure";
            public int StopPressure;
            public int StopSize;
            public bool IgnoreButtonFinger = true;
            public bool IgnoreNearFingers = true;
            public bool PalmRejection = true;

            public static Settings FromJson(string json)
            {
                Dictionary<string, object> root = ParseObject(json);
                Dictionary<string, object> obj = GetObject(root, "settings") ?? root;
                var current = RegistrySettings.Read();
                Settings settings = RegistrySettings.FromRaw(current);

                settings.ClickMode = GetString(obj, "clickMode", settings.ClickMode);
                settings.FeedbackLevel = GetInt(obj, "feedbackLevel", settings.FeedbackLevel);
                settings.SilentClicking = GetBool(obj, "silentClicking", settings.SilentClicking);
                settings.StopMode = GetString(obj, "stopMode", settings.StopMode);
                settings.StopPressure = GetInt(obj, "stopPressure", settings.StopPressure);
                settings.StopSize = GetInt(obj, "stopSize", settings.StopSize);
                settings.IgnoreButtonFinger = GetBool(obj, "ignoreButtonFinger", settings.IgnoreButtonFinger);
                settings.IgnoreNearFingers = GetBool(obj, "ignoreNearFingers", settings.IgnoreNearFingers);
                settings.PalmRejection = GetBool(obj, "palmRejection", settings.PalmRejection);

                settings.Validate();
                return settings;
            }

            public void Validate()
            {
                if (ClickMode != "macos" && ClickMode != "disable-feedback" && ClickMode != "maximum-feedback")
                    throw new ValidationException("invalid-click-mode", "clickMode must be macos, disable-feedback, or maximum-feedback.");
                if (FeedbackLevel < 0 || FeedbackLevel > 2)
                    throw new ValidationException("invalid-feedback-level", "feedbackLevel must be 0, 1, or 2.");
                if (StopMode != "do-nothing" && StopMode != "pressure" && StopMode != "size")
                    throw new ValidationException("invalid-stop-mode", "stopMode must be do-nothing, pressure, or size.");
                if (StopMode == "pressure" && StopPressure < 0)
                    throw new ValidationException("invalid-stop-pressure", "stopPressure must be greater than or equal to 0.");
                if (StopMode == "size" && StopSize < 0)
                    throw new ValidationException("invalid-stop-size", "stopSize must be greater than or equal to 0.");
            }

            public Dictionary<string, object> ToDictionary()
            {
                return new Dictionary<string, object>
                {
                    { "clickMode", ClickMode },
                    { "feedbackLevel", FeedbackLevel },
                    { "silentClicking", SilentClicking },
                    { "stopMode", StopMode },
                    { "stopPressure", StopPressure },
                    { "stopSize", StopSize },
                    { "ignoreButtonFinger", IgnoreButtonFinger },
                    { "ignoreNearFingers", IgnoreNearFingers },
                    { "palmRejection", PalmRejection }
                };
            }
        }

        private sealed class RawSettings
        {
            public int ButtonDisabled = 0;
            public int FeedbackClick = 0x060617;
            public int FeedbackRelease = 0x000014;
            public int StopPressure = 0;
            public int StopSize = -1;
            public int IgnoreButtonFinger = 1;
            public int IgnoreNearFingers = 1;
            public int PalmRejection = 1;

            public Dictionary<string, object> ToDictionary()
            {
                return new Dictionary<string, object>
                {
                    { "ButtonDisabled", ButtonDisabled },
                    { "FeedbackClick", FeedbackClick },
                    { "FeedbackRelease", FeedbackRelease },
                    { "StopPressure", StopPressure },
                    { "StopSize", StopSize },
                    { "IgnoreButtonFinger", IgnoreButtonFinger },
                    { "IgnoreNearFingers", IgnoreNearFingers },
                    { "PalmRejection", PalmRejection }
                };
            }
        }

        private static class RegistrySettings
        {
            private const string UsbParametersPath = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\WUDF\Services\AmtPtpDeviceUsbUm\Parameters";
            private const string WudfServicesPath = @"SOFTWARE\Microsoft\Windows NT\CurrentVersion\WUDF\Services";
            private const string CurrentControlServicesPath = @"SYSTEM\CurrentControlSet\Services";

            public static RawSettings Read()
            {
                var settings = new RawSettings();

                try
                {
                    using (RegistryKey key = Registry.LocalMachine.OpenSubKey(UsbParametersPath))
                    {
                        if (key == null)
                            return settings;

                        settings.ButtonDisabled = GetInt32(key, "ButtonDisabled", settings.ButtonDisabled);
                        settings.FeedbackClick = GetInt32(key, "FeedbackClick", settings.FeedbackClick);
                        settings.FeedbackRelease = GetInt32(key, "FeedbackRelease", settings.FeedbackRelease);
                        settings.StopPressure = GetInt32(key, "StopPressure", settings.StopPressure);
                        settings.StopSize = GetInt32(key, "StopSize", settings.StopSize);
                        settings.IgnoreButtonFinger = GetInt32(key, "IgnoreButtonFinger", settings.IgnoreButtonFinger);
                        settings.IgnoreNearFingers = GetInt32(key, "IgnoreNearFingers", settings.IgnoreNearFingers);
                        settings.PalmRejection = GetInt32(key, "PalmRejection", settings.PalmRejection);
                    }
                }
                catch
                {
                }

                return settings;
            }

            public static void Save(RawSettings settings)
            {
                Save(WudfServicesPath, "AmtPtpDeviceUsbUm", settings);
                Save(CurrentControlServicesPath, "AmtPtpHidFilter", settings);
            }

            public static RawSettings ToRaw(Settings settings)
            {
                var raw = new RawSettings();

                if (settings.ClickMode == "disable-feedback")
                {
                    raw.ButtonDisabled = 1;
                    raw.FeedbackClick = 0;
                    raw.FeedbackRelease = 0;
                }
                else if (settings.ClickMode == "maximum-feedback")
                {
                    raw.ButtonDisabled = 0;
                    raw.FeedbackClick = 0xffffff;
                    raw.FeedbackRelease = 0xffffff;
                }
                else
                {
                    raw.ButtonDisabled = 0;
                    raw.FeedbackClick = settings.FeedbackLevel == 0 ? 0x040415 : settings.FeedbackLevel == 1 ? 0x060617 : 0x08081e;
                    raw.FeedbackRelease = settings.FeedbackLevel == 0 ? 0x000010 : settings.FeedbackLevel == 1 ? 0x000014 : 0x020218;

                    if (settings.SilentClicking)
                    {
                        raw.FeedbackClick = raw.FeedbackClick & 0x0000ff;
                        raw.FeedbackRelease = raw.FeedbackRelease & 0x0000ff;
                    }
                }

                if (settings.StopMode == "do-nothing")
                {
                    raw.StopPressure = -1;
                    raw.StopSize = -1;
                }
                else if (settings.StopMode == "pressure")
                {
                    raw.StopPressure = settings.StopPressure;
                    raw.StopSize = -1;
                }
                else
                {
                    raw.StopPressure = -1;
                    raw.StopSize = settings.StopSize;
                }

                raw.IgnoreButtonFinger = settings.IgnoreButtonFinger ? 1 : 0;
                raw.IgnoreNearFingers = settings.IgnoreNearFingers ? 1 : 0;
                raw.PalmRejection = settings.PalmRejection ? 1 : 0;
                return raw;
            }

            public static Settings FromRaw(RawSettings raw)
            {
                var settings = new Settings();

                if (raw.ButtonDisabled != 0)
                {
                    settings.ClickMode = "disable-feedback";
                    settings.FeedbackLevel = 1;
                    settings.SilentClicking = false;
                }
                else if (raw.FeedbackClick == 0xffffff && raw.FeedbackRelease == 0xffffff)
                {
                    settings.ClickMode = "maximum-feedback";
                    settings.FeedbackLevel = 1;
                    settings.SilentClicking = false;
                }
                else
                {
                    settings.ClickMode = "macos";
                    settings.FeedbackLevel = 1;
                    settings.SilentClicking = (raw.FeedbackClick & 0xffff00) == 0 && (raw.FeedbackRelease & 0xffff00) == 0;

                    if ((raw.FeedbackClick & 0x0000ff) == 0x15 && (raw.FeedbackRelease & 0x0000ff) == 0x10)
                        settings.FeedbackLevel = 0;
                    else if ((raw.FeedbackClick & 0x0000ff) == 0x1e && (raw.FeedbackRelease & 0x0000ff) == 0x18)
                        settings.FeedbackLevel = 2;
                }

                if (raw.StopPressure == -1 && raw.StopSize == -1)
                {
                    settings.StopMode = "do-nothing";
                    settings.StopPressure = 0;
                    settings.StopSize = 0;
                }
                else if (raw.StopPressure != -1)
                {
                    settings.StopMode = "pressure";
                    settings.StopPressure = raw.StopPressure;
                    settings.StopSize = 0;
                }
                else
                {
                    settings.StopMode = "size";
                    settings.StopPressure = 0;
                    settings.StopSize = raw.StopSize;
                }

                settings.IgnoreButtonFinger = raw.IgnoreButtonFinger != 0;
                settings.IgnoreNearFingers = raw.IgnoreNearFingers != 0;
                settings.PalmRejection = raw.PalmRejection != 0;
                return settings;
            }

            public static object ToResponse(RawSettings raw, string command)
            {
                return new Dictionary<string, object>
                {
                    { "ok", true },
                    { "command", command },
                    { "settings", FromRaw(raw).ToDictionary() },
                    { "registry", raw.ToDictionary() }
                };
            }

            private static void Save(string key, string name, RawSettings settings)
            {
                try
                {
                    using (RegistryKey keyServices = Registry.LocalMachine.OpenSubKey(key, true))
                    using (RegistryKey keyDevice = keyServices.CreateSubKey(name, true))
                    using (RegistryKey keyParameters = keyDevice.CreateSubKey("Parameters", true))
                    {
                        keyParameters.SetValue("ButtonDisabled", settings.ButtonDisabled);
                        keyParameters.SetValue("FeedbackClick", settings.FeedbackClick);
                        keyParameters.SetValue("FeedbackRelease", settings.FeedbackRelease);
                        keyParameters.SetValue("StopPressure", settings.StopPressure);
                        keyParameters.SetValue("StopSize", settings.StopSize);
                        keyParameters.SetValue("IgnoreButtonFinger", settings.IgnoreButtonFinger);
                        keyParameters.SetValue("IgnoreNearFingers", settings.IgnoreNearFingers);
                        keyParameters.SetValue("PalmRejection", settings.PalmRejection);
                    }
                }
                catch (Exception ex)
                {
                    throw new ValidationException("registry-write-failed", "Error writing to the registry: " + ex);
                }
            }

            private static int GetInt32(RegistryKey key, string name, int fallback)
            {
                try
                {
                    return (int)key.GetValue(name);
                }
                catch
                {
                    return fallback;
                }
            }
        }

        private static Dictionary<string, object> GetObject(Dictionary<string, object> obj, string name)
        {
            object value;
            return obj.TryGetValue(name, out value) ? value as Dictionary<string, object> : null;
        }

        private static string GetString(Dictionary<string, object> obj, string name, string fallback)
        {
            object value;
            return obj.TryGetValue(name, out value) && value != null ? Convert.ToString(value) : fallback;
        }

        private static int GetInt(Dictionary<string, object> obj, string name, int fallback)
        {
            object value;
            if (!obj.TryGetValue(name, out value) || value == null)
                return fallback;

            try
            {
                return Convert.ToInt32(value);
            }
            catch
            {
                throw new ValidationException("invalid-" + ToKebabCase(name), name + " must be an integer.");
            }
        }

        private static bool GetBool(Dictionary<string, object> obj, string name, bool fallback)
        {
            object value;
            if (!obj.TryGetValue(name, out value) || value == null)
                return fallback;

            try
            {
                return Convert.ToBoolean(value);
            }
            catch
            {
                throw new ValidationException("invalid-" + ToKebabCase(name), name + " must be true or false.");
            }
        }

        private static string ToKebabCase(string value)
        {
            var chars = new List<char>();
            foreach (char c in value)
            {
                if (char.IsUpper(c) && chars.Count > 0)
                    chars.Add('-');
                chars.Add(char.ToLowerInvariant(c));
            }
            return new string(chars.ToArray());
        }
    }

    internal sealed class ValidationException : Exception
    {
        public ValidationException(string code, string message)
            : base(message)
        {
            Code = code;
        }

        public string Code { get; private set; }
    }

    internal static class UsbDevice
    {
        private static readonly IntPtr InvalidHandleValue = new IntPtr(-1);

        public static bool RestartDevices(Action action = null)
        {
            Guid guid = new Guid("4a5064e5-7d39-41d1-a0e4-81097edce967");
            bool success = false;
            IntPtr deviceInfoSet = EnableDevices(false, guid, InvalidHandleValue, ref success);

            if (action != null)
                action();

            if (success)
                EnableDevices(true, guid, deviceInfoSet, ref success);

            if (deviceInfoSet != InvalidHandleValue)
                SetupDiDestroyDeviceInfoList(deviceInfoSet);

            return success;
        }

        private static IntPtr EnableDevices(bool enable, Guid guid, IntPtr deviceInfoSetOverride, ref bool success)
        {
            IntPtr deviceInfoSet = deviceInfoSetOverride != InvalidHandleValue ? deviceInfoSetOverride :
                SetupDiGetClassDevs(ref guid, IntPtr.Zero, IntPtr.Zero, DIGCF_PRESENT | DIGCF_DEVICEINTERFACE);
            if (deviceInfoSet == InvalidHandleValue)
                return InvalidHandleValue;

            uint index = 0;

            while (true)
            {
                SP_DEVINFO_DATA devInfo = new SP_DEVINFO_DATA();
                devInfo.cbSize = (uint)Marshal.SizeOf(devInfo);
                if (!SetupDiEnumDeviceInfo(deviceInfoSet, index, ref devInfo))
                    break;
                index++;

                SP_PROPCHANGE_PARAMS propChange = new SP_PROPCHANGE_PARAMS();
                propChange.ClassInstallHeader = new SP_CLASSINSTALL_HEADER();
                propChange.ClassInstallHeader.cbSize = (uint)Marshal.SizeOf(propChange.ClassInstallHeader);
                propChange.ClassInstallHeader.InstallFunction = DIF_PROPERTYCHANGE;
                propChange.Scope = DICS_FLAG_GLOBAL;
                propChange.StateChange = enable ? DICS_ENABLE : DICS_DISABLE;

                if (SetupDiSetClassInstallParams(deviceInfoSet, ref devInfo, ref propChange, Marshal.SizeOf(propChange)) &&
                    SetupDiCallClassInstaller(DIF_PROPERTYCHANGE, deviceInfoSet, ref devInfo))
                {
                    success = true;
                }
            }

            return deviceInfoSet;
        }

        private const int DIGCF_PRESENT = 0x2;
        private const int DIGCF_DEVICEINTERFACE = 0x10;
        private const uint DIF_PROPERTYCHANGE = 0x12;
        private const uint DICS_ENABLE = 1;
        private const uint DICS_DISABLE = 2;
        private const uint DICS_FLAG_GLOBAL = 1;

        [DllImport("setupapi.dll", CharSet = CharSet.Auto)]
        private static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, IntPtr enumerator, IntPtr hwndParent, int flags);

        [DllImport("setupapi.dll", SetLastError = true)]
        private static extern bool SetupDiDestroyDeviceInfoList(IntPtr deviceInfoSet);

        [DllImport("setupapi.dll", SetLastError = true)]
        private static extern bool SetupDiEnumDeviceInfo(IntPtr deviceInfoSet, uint memberIndex, ref SP_DEVINFO_DATA deviceInfoData);

        [DllImport("setupapi.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern bool SetupDiSetClassInstallParams(IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData, ref SP_PROPCHANGE_PARAMS classInstallParams, int classInstallParamsSize);

        [DllImport("setupapi.dll", SetLastError = true)]
        private static extern bool SetupDiCallClassInstaller(uint installFunction, IntPtr deviceInfoSet, ref SP_DEVINFO_DATA deviceInfoData);

        [StructLayout(LayoutKind.Sequential)]
        private struct SP_DEVINFO_DATA
        {
            public uint cbSize;
            public Guid ClassGuid;
            public uint DevInst;
            public IntPtr Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SP_CLASSINSTALL_HEADER
        {
            public uint cbSize;
            public uint InstallFunction;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct SP_PROPCHANGE_PARAMS
        {
            public SP_CLASSINSTALL_HEADER ClassInstallHeader;
            public uint StateChange;
            public uint Scope;
            public uint HwProfile;
        }
    }

    internal static class BtDevice
    {
        private const uint FILE_DEVICE_UNKNOWN = 0x00000022;
        private const uint METHOD_BUFFERED = 0;
        private const uint FILE_ANY_ACCESS = 0;

        public static readonly uint IOCTL_RELOAD_SETTINGS = CtlCode(FILE_DEVICE_UNKNOWN, 0x800, METHOD_BUFFERED, FILE_ANY_ACCESS);
        public static readonly uint IOCTL_GET_BATTERY = CtlCode(FILE_DEVICE_UNKNOWN, 0x801, METHOD_BUFFERED, FILE_ANY_ACCESS);

        private const uint GENERIC_READ = 0x80000000;
        private const uint GENERIC_WRITE = 0x40000000;
        private const uint OPEN_EXISTING = 3;
        private const uint FILE_SHARE_READ = 0x00000001;
        private const uint FILE_SHARE_WRITE = 0x00000002;

        private static uint CtlCode(uint deviceType, uint function, uint method, uint access)
        {
            return (deviceType << 16) | (access << 14) | (function << 2) | method;
        }

        public static bool SendIoctl(uint code, out int error)
        {
            uint ignored;
            return ExecuteIoctl(code, out ignored, false, out error);
        }

        public static bool SendIoctl(uint code, out uint result, out int error)
        {
            return ExecuteIoctl(code, out result, true, out error);
        }

        private static bool ExecuteIoctl(uint code, out uint result, bool expectData, out int error)
        {
            result = 0;
            error = 0;
            SafeFileHandle hDevice = null;
            IntPtr pOutBuffer = IntPtr.Zero;

            try
            {
                hDevice = CreateFile(
                    @"\\.\AmtPtpControlDeviceUm",
                    GENERIC_READ | GENERIC_WRITE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    IntPtr.Zero,
                    OPEN_EXISTING,
                    0,
                    IntPtr.Zero
                );

                if (hDevice.IsInvalid)
                {
                    error = Marshal.GetLastWin32Error();
                    return false;
                }

                uint outBufferSize = 0;
                if (expectData)
                {
                    outBufferSize = sizeof(uint);
                    pOutBuffer = Marshal.AllocHGlobal((int)outBufferSize);
                }

                bool success = DeviceIoControl(
                    hDevice,
                    code,
                    IntPtr.Zero,
                    0,
                    pOutBuffer,
                    outBufferSize,
                    out _,
                    IntPtr.Zero
                );

                if (success && expectData)
                    result = (uint)Marshal.ReadInt32(pOutBuffer);
                else if (!success)
                    error = Marshal.GetLastWin32Error();

                return success;
            }
            finally
            {
                if (pOutBuffer != IntPtr.Zero)
                    Marshal.FreeHGlobal(pOutBuffer);
                if (hDevice != null)
                    hDevice.Dispose();
            }
        }

        [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        private static extern SafeFileHandle CreateFile(
            string lpFileName,
            uint dwDesiredAccess,
            uint dwShareMode,
            IntPtr lpSecurityAttributes,
            uint dwCreationDisposition,
            uint dwFlagsAndAttributes,
            IntPtr hTemplateFile
        );

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern bool DeviceIoControl(
            SafeFileHandle hDevice,
            uint dwIoControlCode,
            IntPtr lpInBuffer,
            uint nInBufferSize,
            IntPtr lpOutBuffer,
            uint nOutBufferSize,
            out uint lpBytesReturned,
            IntPtr lpOverlapped
        );
    }
}
