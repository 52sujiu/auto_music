#include <ntddk.h>
#include <wdf.h>
#include <vhf.h>

// Report 1: keyboard (modifier, reserved, six key usages).
// Report 2: mouse (three buttons, relative X/Y/wheel; movement is always zero).
static UCHAR ReportDescriptor[] = {
    0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, 0x01,
    0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00,
    0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,
    0x95, 0x01, 0x75, 0x08, 0x81, 0x03,
    0x19, 0x00, 0x29, 0x65, 0x15, 0x00, 0x25, 0x65,
    0x75, 0x08, 0x95, 0x06, 0x81, 0x00, 0xC0,
    0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x85, 0x02,
    0x09, 0x01, 0xA1, 0x00, 0x05, 0x09, 0x19, 0x01,
    0x29, 0x03, 0x15, 0x00, 0x25, 0x01, 0x95, 0x03,
    0x75, 0x01, 0x81, 0x02, 0x95, 0x05, 0x75, 0x01,
    0x81, 0x03, 0x05, 0x01, 0x09, 0x30, 0x09, 0x31,
    0x09, 0x38, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08,
    0x95, 0x03, 0x81, 0x06, 0xC0, 0xC0
};

typedef struct _DEVICE_CONTEXT {
    VHFHANDLE VhfHandle;
} DEVICE_CONTEXT, *PDEVICE_CONTEXT;
WDF_DECLARE_CONTEXT_TYPE_WITH_NAME(DEVICE_CONTEXT, DeviceContextGet);

DRIVER_INITIALIZE DriverEntry;
EVT_WDF_DRIVER_DEVICE_ADD AutoMusicEvtDeviceAdd;
EVT_WDF_OBJECT_CONTEXT_CLEANUP AutoMusicEvtDeviceCleanup;
EVT_WDF_IO_QUEUE_IO_WRITE AutoMusicEvtIoWrite;
EVT_WDF_FILE_CLEANUP AutoMusicEvtFileCleanup;

static NTSTATUS SubmitReport(PDEVICE_CONTEXT context, PUCHAR report, ULONG length)
{
    HID_XFER_PACKET packet;
    packet.reportId = report[0];
    packet.reportBuffer = report;
    packet.reportBufferLen = length;
    return VhfReadReportSubmit(context->VhfHandle, &packet);
}

static BOOLEAN AllowedUsage(UCHAR usage)
{
    switch (usage) {
    case 0: case 0x05: case 0x06: case 0x10: case 0x11:
    case 0x19: case 0x1B: case 0x1D: case 0x36:
        return TRUE;
    default:
        return FALSE;
    }
}

VOID AutoMusicEvtIoWrite(WDFQUEUE queue, WDFREQUEST request, size_t length)
{
    PUCHAR buffer;
    NTSTATUS status;
    size_t index;
    PDEVICE_CONTEXT context = DeviceContextGet(WdfIoQueueGetDevice(queue));

    if (length != 9 && length != 5) {
        WdfRequestComplete(request, STATUS_INVALID_BUFFER_SIZE);
        return;
    }
    status = WdfRequestRetrieveInputBuffer(request, length, (PVOID *)&buffer, NULL);
    if (!NT_SUCCESS(status)) {
        WdfRequestComplete(request, status);
        return;
    }
    if (length == 9) {
        if (buffer[0] != 1 || buffer[1] != 0 || buffer[2] != 0) {
            WdfRequestComplete(request, STATUS_INVALID_PARAMETER);
            return;
        }
        for (index = 3; index < 9; ++index) {
            if (!AllowedUsage(buffer[index])) {
                WdfRequestComplete(request, STATUS_INVALID_PARAMETER);
                return;
            }
        }
    } else if (buffer[0] != 2 || (buffer[1] & ~7) != 0 ||
               buffer[2] != 0 || buffer[3] != 0 || buffer[4] != 0) {
        WdfRequestComplete(request, STATUS_INVALID_PARAMETER);
        return;
    }

    status = SubmitReport(context, buffer, (ULONG)length);
    WdfRequestCompleteWithInformation(request, status, NT_SUCCESS(status) ? length : 0);
}

VOID AutoMusicEvtFileCleanup(WDFFILEOBJECT fileObject)
{
    WDFDEVICE device = WdfFileObjectGetDevice(fileObject);
    PDEVICE_CONTEXT context = DeviceContextGet(device);
    UCHAR keyboardUp[9] = {1, 0, 0, 0, 0, 0, 0, 0, 0};
    UCHAR mouseUp[5] = {2, 0, 0, 0, 0};
    if (context->VhfHandle != NULL) {
        (void)SubmitReport(context, keyboardUp, sizeof(keyboardUp));
        (void)SubmitReport(context, mouseUp, sizeof(mouseUp));
    }
}

VOID AutoMusicEvtDeviceCleanup(WDFOBJECT object)
{
    PDEVICE_CONTEXT context = DeviceContextGet((WDFDEVICE)object);
    if (context->VhfHandle != NULL) {
        VhfDelete(context->VhfHandle, TRUE);
        context->VhfHandle = NULL;
    }
}

NTSTATUS AutoMusicEvtDeviceAdd(WDFDRIVER driver, PWDFDEVICE_INIT deviceInit)
{
    DECLARE_CONST_UNICODE_STRING(deviceName, L"\\Device\\AutoMusicVhid");
    DECLARE_CONST_UNICODE_STRING(linkName, L"\\DosDevices\\AutoMusicVhid");
    DECLARE_CONST_UNICODE_STRING(sddl, L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GW;;;AU)");
    WDF_OBJECT_ATTRIBUTES attributes;
    WDF_FILEOBJECT_CONFIG fileConfig;
    WDF_IO_QUEUE_CONFIG queueConfig;
    VHF_CONFIG vhfConfig;
    WDFDEVICE device;
    PDEVICE_CONTEXT context;
    NTSTATUS status;
    UNREFERENCED_PARAMETER(driver);

    status = WdfDeviceInitAssignName(deviceInit, &deviceName);
    if (!NT_SUCCESS(status)) return status;
    status = WdfDeviceInitAssignSDDLString(deviceInit, &sddl);
    if (!NT_SUCCESS(status)) return status;
    WdfDeviceInitSetExclusive(deviceInit, TRUE);
    WDF_FILEOBJECT_CONFIG_INIT(&fileConfig, WDF_NO_EVENT_CALLBACK,
                               WDF_NO_EVENT_CALLBACK, AutoMusicEvtFileCleanup);
    WdfDeviceInitSetFileObjectConfig(deviceInit, &fileConfig, WDF_NO_OBJECT_ATTRIBUTES);
    WDF_OBJECT_ATTRIBUTES_INIT_CONTEXT_TYPE(&attributes, DEVICE_CONTEXT);
    attributes.EvtCleanupCallback = AutoMusicEvtDeviceCleanup;
    status = WdfDeviceCreate(&deviceInit, &attributes, &device);
    if (!NT_SUCCESS(status)) return status;
    context = DeviceContextGet(device);
    context->VhfHandle = NULL;

    WDF_IO_QUEUE_CONFIG_INIT_DEFAULT_QUEUE(&queueConfig, WdfIoQueueDispatchSequential);
    queueConfig.EvtIoWrite = AutoMusicEvtIoWrite;
    status = WdfIoQueueCreate(device, &queueConfig, WDF_NO_OBJECT_ATTRIBUTES, NULL);
    if (!NT_SUCCESS(status)) return status;

    VHF_CONFIG_INIT(&vhfConfig, WdfDeviceWdmGetDeviceObject(device),
                    (USHORT)sizeof(ReportDescriptor), ReportDescriptor);
    vhfConfig.VendorID = 0x0000;
    vhfConfig.ProductID = 0x0001;
    vhfConfig.VersionNumber = 0x0001;
    status = VhfCreate(&vhfConfig, &context->VhfHandle);
    if (!NT_SUCCESS(status)) return status;
    status = VhfStart(context->VhfHandle);
    if (!NT_SUCCESS(status)) return status;
    return WdfDeviceCreateSymbolicLink(device, &linkName);
}

NTSTATUS DriverEntry(PDRIVER_OBJECT driverObject, PUNICODE_STRING registryPath)
{
    WDF_DRIVER_CONFIG config;
    WDF_DRIVER_CONFIG_INIT(&config, AutoMusicEvtDeviceAdd);
    return WdfDriverCreate(driverObject, registryPath, WDF_NO_OBJECT_ATTRIBUTES,
                           &config, WDF_NO_HANDLE);
}
