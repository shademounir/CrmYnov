#if MANAGED_WITHDRAWAL_TEST
using CrmYnov.TelephonyAgent;

await WithdrawalContractSelfTest.RunAsync();
Console.WriteLine("PASS withdrawal contract: managed source-generated JSON and in-memory HTTP; no SDK, network, DPAPI or filesystem access.");
#endif
