package com.apexpump.station;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // افزونهٔ محلیِ نصبِ بروزرسانی — باید پیش از super.onCreate ثبت شود
        registerPlugin(ApexApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
