//
//  ContentView.swift
//  375
//
//  Created by Juan Lopez  on 14/04/26.
//

import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var environment: AppEnvironment

    var body: some View {
        Group {
            if environment.isPaired {
                AppShellView()
                    .environmentObject(environment)
            } else {
                PairingView()
                    .environmentObject(environment)
            }
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(AppEnvironment.bootstrap())
}
